import type { ExtractionData } from "@/types";
import { buildJsonSchema, unwrapGrounded } from "./schema";
import {
  PDF_NO_TEXT_ERROR,
  QUOTE_INSTRUCTION,
  VERBATIM_INSTRUCTION,
  type ExtractionInput,
  type ExtractionOutput,
} from "./types";

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
  const system = grounded
    ? `You are a precise data extraction assistant. Extract the requested fields from the document and return JSON matching the schema. Use null for missing values. Dates in ISO 8601 (YYYY-MM-DD). Numbers without currency symbols. ${VERBATIM_INSTRUCTION} ${QUOTE_INSTRUCTION}`
    : `You are a precise data extraction assistant. Extract the requested fields from the document and return JSON matching the schema. Use null for missing values. Dates in ISO 8601 (YYYY-MM-DD). Numbers without currency symbols. ${VERBATIM_INSTRUCTION}`;
  const instruction = `${input.prompt ? `Context: ${input.prompt}\n\n` : ""}Extract ${input.extractMultiple ? "ALL records with" : ""} these fields:\n${input.fields.map((f) => `- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ""}`).join("\n")}`;

  let user: string;
  let images: string[] | undefined;
  if (input.source.kind === "image") {
    user = instruction;
    images = [input.source.base64];
  } else {
    user = `${instruction}\n\nDOCUMENT TEXT:\n${input.source.text}`;
  }

  const out = await ollamaChat(input.baseUrl, input.model ?? "gemma3:4b", schema, system, user, images);
  if (!out.success) return out;
  if (!grounded) {
    if (input.extractMultiple) {
      const d = out.data as Record<string, unknown>;
      return { success: true, data: (Array.isArray(d) ? d : (d.items as never)) ?? d };
    }
    return out;
  }
  const { data, quotes } = unwrapGrounded(out.data, input.extractMultiple);
  return { success: true, data: data as ExtractionData, quotes };
}
