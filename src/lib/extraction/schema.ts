import type { ExtractionField } from "@/types";

export function buildItemSchema(fields: ExtractionField[]) {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const field of fields) {
    required.push(field.name);

    switch (field.type) {
      case "text":
        properties[field.name] = {
          type: ["string", "null"],
          description: field.description || `The ${field.name} extracted from the document`,
        };
        break;
      case "number":
        properties[field.name] = {
          type: ["number", "null"],
          description: field.description || `The ${field.name} as a numeric value`,
        };
        break;
      case "date":
        properties[field.name] = {
          type: ["string", "null"],
          description: field.description || `The ${field.name} in ISO 8601 date format (YYYY-MM-DD)`,
        };
        break;
      case "boolean":
        properties[field.name] = {
          type: ["boolean", "null"],
          description: field.description || `Whether ${field.name} is true or false`,
        };
        break;
      case "array":
        properties[field.name] = {
          type: "array",
          items: { type: "string" },
          description: field.description || `A list of ${field.name} items`,
        };
        break;
      default:
        properties[field.name] = {
          type: ["string", "null"],
          description: field.description || `The ${field.name} extracted from the document`,
        };
    }
  }

  return {
    type: "object" as const,
    properties,
    required,
    additionalProperties: false,
  };
}

export function buildJsonSchema(fields: ExtractionField[], extractMultiple: boolean) {
  const itemSchema = buildItemSchema(fields);

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
