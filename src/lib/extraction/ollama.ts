import { buildJsonSchema } from "./schema";
import { pdfToText } from "./pdfText";
import type { ExtractionInput, ExtractionOutput } from "./types";

export async function ollamaChat(
  baseUrl: string, model: string, schema: object, system: string, user: string
): Promise<ExtractionOutput> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, stream: false, format: schema,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
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
  const pdfText = await pdfToText(input.pdfBase64);
  if (!pdfText.success) return pdfText;
  const truncated = pdfText.text;
  const schema = buildJsonSchema(input.fields, input.extractMultiple);
  const system = "You are a precise data extraction assistant. Extract the requested fields from the document text and return JSON matching the schema. Use null for missing values. Dates in ISO 8601 (YYYY-MM-DD). Numbers without currency symbols.";
  const user = `${input.prompt ? `Context: ${input.prompt}\n\n` : ""}Extract ${input.extractMultiple ? "ALL records with" : ""} these fields:\n${input.fields.map((f) => `- ${f.name} (${f.type})`).join("\n")}\n\nDOCUMENT TEXT:\n${truncated}`;
  const out = await ollamaChat(input.baseUrl, input.model ?? "gemma3:4b", schema, system, user);
  if (out.success && input.extractMultiple) {
    const d = out.data as Record<string, unknown>;
    return { success: true, data: (Array.isArray(d) ? d : (d.items as never)) ?? d };
  }
  return out;
}
