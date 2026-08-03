import { describe, it, expect } from "vitest";
import { buildJsonSchema, unwrapGrounded } from "../schema";

const fields = [
  { id: "1", name: "invoice_number", type: "text" as const },
  { id: "2", name: "total", type: "number" as const },
  { id: "3", name: "line_items", type: "array" as const },
];

// Minimal shape of what buildJsonSchema returns, just enough for these
// assertions — avoids `as any` on the real (structurally-varying) return type.
interface JsonSchemaLike {
  type?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties: Record<string, { type: string | string[]; items?: JsonSchemaLike; additionalProperties?: boolean }>;
}

describe("buildJsonSchema", () => {
  it("builds a strict single-record schema", () => {
    const s = buildJsonSchema(fields, false) as unknown as JsonSchemaLike;
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["invoice_number", "total", "line_items"]);
    expect(s.properties.invoice_number.type).toEqual(["string", "null"]);
    expect(s.properties.total.type).toEqual(["number", "null"]);
    expect(s.properties.line_items.type).toBe("array");
  });

  it("wraps in items array when extractMultiple", () => {
    const s = buildJsonSchema(fields, true) as unknown as JsonSchemaLike;
    expect(s.properties.items.type).toBe("array");
    expect(s.required).toEqual(["items"]);
    expect(s.properties.items.items?.additionalProperties).toBe(false);
  });

  it("omitting opts produces the exact same shape as the ungrounded call (compat)", () => {
    expect(buildJsonSchema(fields, false)).toEqual(buildJsonSchema(fields, false, {}));
    expect(buildJsonSchema(fields, false)).toEqual(buildJsonSchema(fields, false, { grounded: false }));
  });
});

interface GroundedFieldSchemaLike {
  type: string;
  properties: {
    value: { type: string | string[] };
    quote: { type: string | string[]; description: string };
  };
  required: string[];
  additionalProperties: boolean;
}

interface GroundedSchemaLike {
  type?: string;
  required?: string[];
  properties: Record<string, GroundedFieldSchemaLike> & {
    items?: { type: string; items: { properties: Record<string, GroundedFieldSchemaLike> } };
  };
}

describe("buildJsonSchema — grounded", () => {
  it("wraps each field as { value, quote } (single record)", () => {
    const s = buildJsonSchema(fields, false, { grounded: true }) as unknown as GroundedSchemaLike;
    expect(s.required).toEqual(["invoice_number", "total", "line_items"]);

    for (const name of ["invoice_number", "total", "line_items"]) {
      const fieldSchema = s.properties[name];
      expect(fieldSchema.type).toBe("object");
      expect(fieldSchema.required).toEqual(["value", "quote"]);
      expect(fieldSchema.additionalProperties).toBe(false);
      expect(fieldSchema.properties.quote.type).toEqual(["string", "null"]);
    }
    // The per-type value schema is preserved inside the wrapper.
    expect(s.properties.invoice_number.properties.value.type).toEqual(["string", "null"]);
    expect(s.properties.total.properties.value.type).toEqual(["number", "null"]);
  });

  it("wraps rows of grounded objects inside the existing items array for extractMultiple", () => {
    const s = buildJsonSchema(fields, true, { grounded: true }) as unknown as GroundedSchemaLike;
    expect(s.required).toEqual(["items"]);
    const rowProps = s.properties.items!.items.properties;
    expect(rowProps.invoice_number.type).toBe("object");
    expect(rowProps.invoice_number.required).toEqual(["value", "quote"]);
    expect(rowProps.invoice_number.properties.value.type).toEqual(["string", "null"]);
  });

  it("ungrounded output is byte-identical to grounded:false / omitted opts", () => {
    expect(buildJsonSchema(fields, false, { grounded: true })).not.toEqual(buildJsonSchema(fields, false));
    expect(buildJsonSchema(fields, false, { grounded: false })).toEqual(buildJsonSchema(fields, false));
  });
});

describe("unwrapGrounded", () => {
  it("unwraps a single grounded record into values + quotes", () => {
    const parsed = {
      invoice_number: { value: "INV-1", quote: "Invoice #INV-1" },
      total: { value: 100, quote: "$100.00" },
      purchase_order: { value: null, quote: null },
    };
    const result = unwrapGrounded(parsed, false);
    expect(result.data).toEqual({ invoice_number: "INV-1", total: 100, purchase_order: null });
    expect(result.quotes).toEqual({
      invoice_number: "Invoice #INV-1",
      total: "$100.00",
      purchase_order: null,
    });
  });

  it("unwraps multi rows (items array) into aligned data + quotes arrays", () => {
    const parsed = {
      items: [
        { name: { value: "Widget", quote: "widget" }, qty: { value: 2, quote: "two" } },
        { name: { value: "Gadget", quote: "gadget" }, qty: { value: 1, quote: null } },
      ],
    };
    const result = unwrapGrounded(parsed, true);
    expect(result.data).toEqual([
      { name: "Widget", qty: 2 },
      { name: "Gadget", qty: 1 },
    ]);
    expect(result.quotes).toEqual([
      { name: "widget", qty: "two" },
      { name: "gadget", qty: null },
    ]);
  });

  it("treats a flat value where {value, quote} is expected as the value with a null quote (defensive)", () => {
    const parsed = { invoice_number: "INV-1", total: { value: 100, quote: "$100.00" } };
    const result = unwrapGrounded(parsed, false);
    expect(result.data).toEqual({ invoice_number: "INV-1", total: 100 });
    expect(result.quotes).toEqual({ invoice_number: null, total: "$100.00" });
  });

  it("also treats an array-typed flat value defensively (quote null)", () => {
    const parsed = { tags: ["a", "b"] };
    const result = unwrapGrounded(parsed, false);
    expect(result.data).toEqual({ tags: ["a", "b"] });
    expect(result.quotes).toEqual({ tags: null });
  });

  it("falls back to an empty array when a multi response has no items and isn't itself an array", () => {
    const result = unwrapGrounded({}, true);
    expect(result.data).toEqual([]);
    expect(result.quotes).toEqual([]);
  });

  it("accepts a bare top-level array for multi mode (no items wrapper)", () => {
    const parsed = [{ name: { value: "Widget", quote: "widget" } }];
    const result = unwrapGrounded(parsed, true);
    expect(result.data).toEqual([{ name: "Widget" }]);
    expect(result.quotes).toEqual([{ name: "widget" }]);
  });
});
