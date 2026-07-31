import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { buildJsonSchema } from "./schema";
import { VERBATIM_INSTRUCTION, type ExtractionInput, type ExtractionOutput } from "./types";

export async function extractWithOpenAI(input: ExtractionInput): Promise<ExtractionOutput> {
  const apiKey = input.apiKey;
  if (!apiKey) return { success: false, error: "OpenAI API key not set — add it in Settings" };
  const openai = new OpenAI({ apiKey });

  let uploadedFileId: string | null = null;

  try {
    // Build the JSON schema for structured output
    const jsonSchema = buildJsonSchema(input.fields, input.extractMultiple);

    // Build the system prompt
    const systemPrompt = (input.extractMultiple
      ? `You are a precise data extraction assistant. Extract ALL matching records/rows from the provided document and return them as a structured JSON array.

Rules:
- Extract ALL records that match the field definitions (e.g., all table rows, all entries)
- Do not skip any records - be thorough
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
- Be precise and accurate - do not make up information`) + `\n- ${VERBATIM_INSTRUCTION}`;

    // Build the user message with file reference
    const extractionInstruction = input.extractMultiple
      ? `Extract ALL records/rows with the following fields from this document (e.g., all table entries, all items in a list):`
      : `Extract the following fields from this document:`;

    const instructionText = `${input.prompt ? `Context: ${input.prompt}\n\n` : ""}${extractionInstruction}

${input.fields.map((f) => `- ${f.name} (${f.type})`).join("\n")}

Analyze the entire document carefully and extract ${input.extractMultiple ? "ALL matching records" : "the requested data"}.`;

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: instructionText },
    ];

    if (input.source.kind === "pdf") {
      // Upload PDF to OpenAI Files API — native PDF reading (works on scans too).
      const buffer = Buffer.from(input.source.base64, "base64");
      const uploadFile = await toFile(buffer, input.filename, { type: "application/pdf" });
      const uploadedFile = await openai.files.create({ file: uploadFile, purpose: "user_data" });
      uploadedFileId = uploadedFile.id;
      userContent.push({
        type: "file",
        file: { file_id: uploadedFileId },
      } as OpenAI.Chat.Completions.ChatCompletionContentPart);
    } else if (input.source.kind === "image") {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${input.source.mediaType};base64,${input.source.base64}` },
      });
    } else {
      userContent[0] = { type: "text", text: `${instructionText}\n\nDOCUMENT TEXT:\n${input.source.text}` };
    }

    // Call OpenAI with file/image/text input and structured output
    const response = await openai.chat.completions.create({
      model: input.model ?? "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extraction_result",
          strict: true,
          schema: jsonSchema,
        },
      },
      max_tokens: 16384,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      return { success: false, error: "No response from AI model" };
    }

    const extractedData = JSON.parse(content);

    // If extractMultiple, unwrap the items array
    const data = input.extractMultiple ? extractedData.items : extractedData;

    return { success: true, data };
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      return { success: false, error: `OpenAI API error: ${error.message}` };
    }
    return { success: false, error: error instanceof Error ? error.message : "An unexpected error occurred" };
  } finally {
    // Clean up: delete the uploaded file
    if (uploadedFileId) {
      try {
        await openai.files.delete(uploadedFileId);
      } catch (e) {
        console.error("Failed to delete uploaded file:", e);
      }
    }
  }
}
