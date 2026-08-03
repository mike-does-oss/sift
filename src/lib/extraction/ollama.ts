import { buildJsonSchema } from "./schema";
import { PDF_NO_TEXT_ERROR, type ExtractionInput, type ExtractionOutput } from "./types";
import { textEngineSystemPrompt, textEngineInstruction, finalizeTextEngineOutput } from "./promptParts";

export async function ollamaChat(
  baseUrl: string, model: string, schema: object, system: string, user: string, images?: string[]
): Promise<ExtractionOutput> {
  let res: Response;
  try {
    const userMessage: { role: "user"; content: string; images?: string[] } = { role: "user", content: user };
    if (images) userMessage.images = images;
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, stream: false, format: schema,
        messages: [{ role: "system", content: system }, userMessage],
        options: { temperature: 0 },
      }),
    });
  } catch {
    return { success: false, error: `Can't reach Ollama at ${baseUrl} — is it running? (start it with \`ollama serve\`)` };
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 || body.includes("not found")) {
      return { success: false, error: `Model "${model}" isn't available in Ollama. Pull it with \`ollama pull ${model}\`.` };
    }
    return { success: false, error: `Ollama error (${res.status}): ${body.slice(0, 200)}` };
  }
  const data = await res.json();
  const content = data?.message?.content;
  if (!content) return { success: false, error: "Empty response from Ollama" };
  try {
    return { success: true, data: JSON.parse(content) };
  } catch {
    return { success: false, error: "Ollama returned invalid JSON" };
  }
}

export async function extractWithOllama(
  input: ExtractionInput & { baseUrl: string }
): Promise<ExtractionOutput> {
  if (input.source.kind === "pdf" && !input.source.text.trim()) {
    return { success: false, error: PDF_NO_TEXT_ERROR };
  }
  const grounded = input.grounded ?? false;
  const schema = buildJsonSchema(input.fields, input.extractMultiple, { grounded });
  const system = textEngineSystemPrompt(grounded);
  const instruction = textEngineInstruction(input);

  let user: string;
  let images: string[] | undefined;
  if (input.source.kind === "image") {
    user = instruction;
    images = [input.source.base64];
  } else {
    user = `${instruction}\n\nDOCUMENT TEXT:\n${input.source.text}`;
  }

  const out = await ollamaChat(input.baseUrl, input.model ?? "gemma3:4b", schema, system, user, images);
  return finalizeTextEngineOutput(out, grounded, input.extractMultiple);
}
