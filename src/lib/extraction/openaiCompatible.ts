import { buildJsonSchema } from "./schema";
import { PDF_NO_TEXT_ERROR, type ExtractionInput, type ExtractionOutput } from "./types";
import { textEngineSystemPrompt, textEngineInstruction, finalizeTextEngineOutput } from "./promptParts";

interface CompatChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export type CompatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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
  user: string | CompatContentPart[]
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
  if (input.source.kind === "pdf" && !input.source.text.trim()) {
    return { success: false, error: PDF_NO_TEXT_ERROR };
  }
  const grounded = input.grounded ?? false;
  const schema = buildJsonSchema(input.fields, input.extractMultiple, { grounded });
  const system = textEngineSystemPrompt(grounded);
  const instruction = textEngineInstruction(input);

  let user: string | CompatContentPart[];
  if (input.source.kind === "image") {
    user = [
      { type: "text", text: instruction },
      { type: "image_url", image_url: { url: `data:${input.source.mediaType};base64,${input.source.base64}` } },
    ];
  } else {
    user = `${instruction}\n\nDOCUMENT TEXT:\n${input.source.text}`;
  }

  const out = await compatChat(input.baseUrl, input.apiKey, input.model ?? "", schema, system, user);
  return finalizeTextEngineOutput(out, grounded, input.extractMultiple);
}
