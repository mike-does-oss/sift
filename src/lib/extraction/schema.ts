import type { ExtractionField } from "@/types";

/** Per-type schema for a field's value alone — the same shape emitted for both grounded and ungrounded requests. */
function fieldValueSchema(field: ExtractionField): object {
  switch (field.type) {
    case "text":
      return {
        type: ["string", "null"],
        description: field.description || `The ${field.name} extracted from the document`,
      };
    case "number":
      return {
        type: ["number", "null"],
        description: field.description || `The ${field.name} as a numeric value`,
      };
    case "date":
      return {
        type: ["string", "null"],
        description: field.description || `The ${field.name} in ISO 8601 date format (YYYY-MM-DD)`,
      };
    case "boolean":
      return {
        type: ["boolean", "null"],
        description: field.description || `Whether ${field.name} is true or false`,
      };
    case "array":
      return {
        type: "array",
        items: { type: "string" },
        description: field.description || `A list of ${field.name} items`,
      };
    default:
      return {
        type: ["string", "null"],
        description: field.description || `The ${field.name} extracted from the document`,
      };
  }
}

const QUOTE_SCHEMA = {
  type: ["string", "null"],
  description: "Exact text from the document this value was taken from, verbatim; null if not directly present.",
};

/** Grounded mode wraps a field's value schema alongside a sibling verbatim `quote`. */
function groundedFieldSchema(field: ExtractionField): object {
  return {
    type: "object" as const,
    properties: { value: fieldValueSchema(field), quote: QUOTE_SCHEMA },
    required: ["value", "quote"],
    additionalProperties: false,
  };
}

export function buildItemSchema(fields: ExtractionField[], grounded = false) {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const field of fields) {
    required.push(field.name);
    properties[field.name] = grounded ? groundedFieldSchema(field) : fieldValueSchema(field);
  }

  return {
    type: "object" as const,
    properties,
    required,
    additionalProperties: false,
  };
}

export function buildJsonSchema(
  fields: ExtractionField[],
  extractMultiple: boolean,
  opts?: { grounded?: boolean }
) {
  const itemSchema = buildItemSchema(fields, opts?.grounded);

  if (extractMultiple) {
    return {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          items: itemSchema,
          description: "Array of extracted records/rows from the document",
        },
      },
      required: ["items"],
      additionalProperties: false,
    };
  }

  return itemSchema;
}

/**
 * Reverses a grounded response into plain values + a parallel quote map.
 * Defensive: a field that comes back as a flat value instead of the expected
 * `{value, quote}` object (shouldn't happen under strict/grammar-constrained
 * decoding, but local models occasionally drift) is treated as the value
 * with a null quote rather than failing the extraction.
 */
function unwrapRow(row: unknown): { values: Record<string, unknown>; quotes: Record<string, string | null> } {
  const values: Record<string, unknown> = {};
  const quotes: Record<string, string | null> = {};
  if (!row || typeof row !== "object") return { values, quotes };

  for (const [key, raw] of Object.entries(row as Record<string, unknown>)) {
    if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw) {
      const wrapped = raw as { value: unknown; quote?: unknown };
      values[key] = wrapped.value;
      quotes[key] = typeof wrapped.quote === "string" ? wrapped.quote : null;
    } else {
      values[key] = raw;
      quotes[key] = null;
    }
  }
  return { values, quotes };
}

export function unwrapGrounded(
  parsed: unknown,
  extractMultiple: boolean
): { data: unknown; quotes: Record<string, string | null> | Array<Record<string, string | null>> } {
  if (extractMultiple) {
    const container = parsed as Record<string, unknown> | null;
    const rows: unknown[] = Array.isArray(parsed)
      ? (parsed as unknown[])
      : Array.isArray(container?.items)
        ? (container!.items as unknown[])
        : [];

    const data: Record<string, unknown>[] = [];
    const quotes: Array<Record<string, string | null>> = [];
    for (const row of rows) {
      const unwrapped = unwrapRow(row);
      data.push(unwrapped.values);
      quotes.push(unwrapped.quotes);
    }
    return { data, quotes };
  }

  const unwrapped = unwrapRow(parsed);
  return { data: unwrapped.values, quotes: unwrapped.quotes };
}
