export type FieldType = "text" | "number" | "date" | "boolean" | "array";

export interface ExtractionField {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
}

/**
 * A per-template few-shot example (§T3): the output shape the model should
 * produce for this template's fields, used to steer local models toward a
 * particular formatting/style convention (e.g. uppercase vendor names).
 * Input snippets are deferred — only output-shape examples are supported
 * this pass. Rides inside `templates.examples` and the job/batch
 * `templateSnapshot` (`{ fields, prompt, extractMultiple, examples? }`).
 */
export interface TemplateExample {
  output: Record<string, unknown>;
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
