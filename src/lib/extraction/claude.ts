import Anthropic from "@anthropic-ai/sdk";
import { buildJsonSchema } from "./schema";
import type { ExtractionInput, ExtractionOutput } from "./types";

function systemPrompt(extractMultiple: boolean): string {
  return extractMultiple
    ? `You are a precise data extraction assistant. Extract ALL matching records/rows from the provided PDF document and return them as structured JSON.

Rules:
- Extract ALL records that match the field definitions (e.g., all table rows, all entries)
- Examine ALL pages of the document carefully
- If a value cannot be found for a field, use null
- For dates, use ISO 8601 format (YYYY-MM-DD)
- For numbers, return numeric values without currency symbols or units
- Be precise and accurate - do not make up information`
    : `You are a precise data extraction assistant. Extract specific information from the provided PDF document and return it as structured JSON.

Rules:
- Extract ONLY the requested fields from the document
- Examine ALL pages of the document carefully
- If a value cannot be found, use null
- For dates, use ISO 8601 format (YYYY-MM-DD)
- For numbers, return numeric values without currency symbols or units
- For arrays/lists, return an array of strings
- Be precise and accurate - do not make up information`;
}

export async function extractWithClaude(input: ExtractionInput): Promise<ExtractionOutput> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false, error: "Anthropic API key not set — add it in Settings" };
  const client = new Anthropic({ apiKey });

  const schema = buildJsonSchema(input.fields, input.extractMultiple);
  const instruction = `${input.prompt ? `Context: ${input.prompt}\n\n` : ""}Extract ${
    input.extractMultiple ? "ALL records/rows with" : ""
  } the following fields from this PDF document:

${input.fields.map((f) => `- ${f.name} (${f.type})`).join("\n")}`;

  try {
    const response = await client.messages.create({
      model: input.model ?? "claude-sonnet-5",
      max_tokens: 16000,
      system: systemPrompt(input.extractMultiple),
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 } },
            { type: "text", text: instruction },
          ],
        },
      ],
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
    return { success: true, data: input.extractMultiple ? parsed.items : parsed };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { success: false, error: `Claude API error: ${err.message}` };
    }
    return { success: false, error: err instanceof Error ? err.message : "Extraction failed" };
  }
}
