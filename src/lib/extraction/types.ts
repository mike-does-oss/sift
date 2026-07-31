import type { ExtractionField, ExtractionData } from "@/types";
import type { ParsedDocument } from "@/lib/documents";

export type { ParsedDocument } from "@/lib/documents";

export interface ExtractionInput {
  source: ParsedDocument;     // parsed upload — text, image, or pdf (base64 + extracted text)
  filename: string;
  fields: ExtractionField[];
  prompt: string;
  extractMultiple: boolean;
  apiKey?: string;            // BYO key override (Anthropic for claude engine)
  model?: string;             // per-plan model tier override (claude engine)
}

export type ExtractionOutput =
  | { success: true; data: ExtractionData }
  | { success: false; error: string };

/**
 * §4 "Verbatim by default" — appended to every engine's system prompt so the
 * model copies values as written instead of normalizing/translating them
 * unless a field description asks for that.
 */
export const VERBATIM_INSTRUCTION =
  "Copy values exactly as written in the document; do not translate, reformat, or normalize unless a field description says otherwise.";

/** Friendly error for text-only engines (ollama, openai-compatible) handed a PDF with no extractable text layer. */
export const PDF_NO_TEXT_ERROR =
  "No selectable text found in this PDF. This provider reads extracted PDF text only — try a cloud provider (Claude/OpenAI read scanned PDFs natively) or upload a page as an image for vision.";
