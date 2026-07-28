export type FieldType = "text" | "number" | "date" | "boolean" | "array";

export interface ExtractionField {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
}

export interface ExtractionResult {
  [key: string]: string | number | boolean | string[] | null;
}

export type ExtractionData = ExtractionResult | ExtractionResult[];

export interface ExtractionResponse {
  success: boolean;
  data?: ExtractionData;
  error?: string;
}
