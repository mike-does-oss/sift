import { buildJsonSchema } from "./schema";
import { pdfToText } from "./pdfText";
import type { ExtractionInput, ExtractionOutput } from "./types";

interface CompatChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function isModelNotFound(status: number, body: string): boolean {
  if (status === 404) return true;
  return /model_not_found|model[^a-z]{0,10}not found/i.test(body);
}

/**
 * Talks to any OpenAI-compatible `/chat/completions` endpoint — used both for
 * user-configured "openai-compatible" servers (vLLM, LM Studio, Groq,
 * Ollama's OpenAI-compat mode…) and for Gemini, which is the same client
 * pinned to Google's OpenAI-compatible base URL. `apiKey` is optional:
 * some local servers don't require one.
 */
export async function compatChat(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  schema: object,
  system: string,
  user: string
): Promise<ExtractionOutput> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "extraction", strict: true, schema } },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    return { success: false, error: `Can't reach ${baseUrl} — check the base URL` };
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { success: false, error: "API key rejected" };
    }
    const body = await res.text();
    if (isModelNotFound(res.status, body)) {
      return { success: false, error: `Model "${model}" not found at this endpoint` };
    }
    return { success: false, error: `Endpoint error (${res.status}): ${body.slice(0, 200)}` };
  }

  const data = (await res.json()) as CompatChatResponse;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return { success: false, error: `Empty response from ${baseUrl}` };
  try {
    return { success: true, data: JSON.parse(content) };
  } catch {
    return { success: false, error: `${baseUrl} returned invalid JSON` };
  }
}

export async function extractWithOpenAICompatible(
  input: ExtractionInput & { baseUrl: string }
): Promise<ExtractionOutput> {
  const pdfText = await pdfToText(input.pdfBase64);
  if (!pdfText.success) return pdfText;
  const truncated = pdfText.text;
  const schema = buildJsonSchema(input.fields, input.extractMultiple);
  const system = "You are a precise data extraction assistant. Extract the requested fields from the document text and return JSON matching the schema. Use null for missing values. Dates in ISO 8601 (YYYY-MM-DD). Numbers without currency symbols.";
  const user = `${input.prompt ? `Context: ${input.prompt}\n\n` : ""}Extract ${input.extractMultiple ? "ALL records with" : ""} these fields:\n${input.fields.map((f) => `- ${f.name} (${f.type})`).join("\n")}\n\nDOCUMENT TEXT:\n${truncated}`;
  const out = await compatChat(input.baseUrl, input.apiKey, input.model ?? "", schema, system, user);
  if (out.success && input.extractMultiple) {
    const d = out.data as Record<string, unknown>;
    return { success: true, data: (Array.isArray(d) ? d : (d.items as never)) ?? d };
  }
  return out;
}
