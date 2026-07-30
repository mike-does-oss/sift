import { describe, it, expect } from "vitest";
import { buildJsonSchema } from "../schema";

const fields = [
  { id: "1", name: "invoice_number", type: "text" as const },
  { id: "2", name: "total", type: "number" as const },
  { id: "3", name: "line_items", type: "array" as const },
];

describe("buildJsonSchema", () => {
  it("builds a strict single-record schema", () => {
    const s = buildJsonSchema(fields, false) as any;
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["invoice_number", "total", "line_items"]);
    expect(s.properties.invoice_number.type).toEqual(["string", "null"]);
    expect(s.properties.total.type).toEqual(["number", "null"]);
    expect(s.properties.line_items.type).toBe("array");
  });

  it("wraps in items array when extractMultiple", () => {
    const s = buildJsonSchema(fields, true) as any;
    expect(s.properties.items.type).toBe("array");
    expect(s.required).toEqual(["items"]);
    expect(s.properties.items.items.additionalProperties).toBe(false);
  });
});
