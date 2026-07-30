import type { ExtractionField, ExtractionData } from "@/types";

export interface ExtractionInput {
  pdfBase64: string;          // base64-encoded PDF bytes, no data: prefix
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
