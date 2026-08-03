import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionData } from "@/types";
import { buildJsonSchema, unwrapGrounded } from "./schema";
import { QUOTE_INSTRUCTION, VERBATIM_INSTRUCTION, type ExtractionInput, type ExtractionOutput } from "./types";

function systemPrompt(extractMultiple: boolean): string {
  const base = extractMultiple
    ? `You are a precise data extraction assistant. Extract ALL matching records/rows from the provided document and return them as structured JSON.

Rules:
- Extract ALL records that match the field definitions (e.g., all table rows, all entries)
- Examine the entire document carefully (all pages, or the full text/image provided)
- If a value cannot be found for a field, use null
- For dates, use ISO 8601 format (YYYY-MM-DD)
- For numbers, return numeric values without currency symbols or units
- Be precise and accurate - do not make up information`
    : `You are a precise data extraction assistant. Extract specific information from the provided document and return it as structured JSON.

Rules:
- Extract ONLY the requested fields from the document
- Examine the entire document carefully (all pages, or the full text/image provided)
- If a value cannot be found, use null
- For dates, use ISO 8601 format (YYYY-MM-DD)
- For numbers, return numeric values without currency symbols or units
- For arrays/lists, return an array of strings
- Be precise and accurate - do not make up information`;
  return `${base}\n- ${VERBATIM_INSTRUCTION}\n- ${QUOTE_INSTRUCTION}`;
}

export async function extractWithClaude(input: ExtractionInput): Promise<ExtractionOutput> {
  const apiKey = input.apiKey;
  if (!apiKey) return { success: false, error: "Anthropic API key not set — add it in Settings" };
  const client = new Anthropic({ apiKey });

  const schema = buildJsonSchema(input.fields, input.extractMultiple, { grounded: true });
  const instruction = `${input.prompt ? `Context: ${input.prompt}\n\n` : ""}Extract ${
    input.extractMultiple ? "ALL records/rows with" : ""
  } the following fields from this document:

${input.fields.map((f) => `- ${f.name} (${f.type})`).join("\n")}`;

  const content: Anthropic.Messages.ContentBlockParam[] = [];
  if (input.source.kind === "pdf") {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.source.base64 } });
    content.push({ type: "text", text: instruction });
  } else if (input.source.kind === "image") {
    content.push({ type: "image", source: { type: "base64", media_type: input.source.mediaType, data: input.source.base64 } });
    content.push({ type: "text", text: instruction });
  } else {
    content.push({ type: "text", text: `${instruction}\n\nDOCUMENT TEXT:\n${input.source.text}` });
  }

  try {
    const response = await client.messages.create({
      model: input.model ?? "claude-sonnet-5",
      max_tokens: 16000,
      system: systemPrompt(input.extractMultiple),
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return { success: false, error: "The model declined to process this document." };
    }
    if (response.stop_reason === "max_tokens") {
      return { success: false, error: "Document too large: output was truncated. Try fewer fields or a smaller document." };
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return { success: false, error: "No response from model" };
    const parsed = JSON.parse(text);
    const { data, quotes } = unwrapGrounded(parsed, input.extractMultiple);
    return { success: true, data: data as ExtractionData, quotes };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { success: false, error: `Claude API error: ${err.message}` };
    }
    return { success: false, error: err instanceof Error ? err.message : "Extraction failed" };
  }
}
