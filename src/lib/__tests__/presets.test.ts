import { describe, it, expect } from "vitest";
import { PRESET_TEMPLATES } from "../presets";

const VALID_TYPES = new Set(["text", "number", "date", "boolean", "array"]);

describe("PRESET_TEMPLATES", () => {
  it("has exactly 9 presets", () => {
    expect(PRESET_TEMPLATES).toHaveLength(9);
  });

  it("has unique keys", () => {
    const keys = PRESET_TEMPLATES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every preset has at least 4 fields", () => {
    for (const preset of PRESET_TEMPLATES) {
      expect(preset.fields.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("every field has a non-empty name and a valid FieldType", () => {
    for (const preset of PRESET_TEMPLATES) {
      for (const field of preset.fields) {
        expect(field.name.trim().length).toBeGreaterThan(0);
        expect(VALID_TYPES.has(field.type)).toBe(true);
      }
    }
  });

  it("has unique field ids within each preset", () => {
    for (const preset of PRESET_TEMPLATES) {
      const ids = preset.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("marks bank-statement-transactions and purchase-order-lines as extractMultiple, the rest false", () => {
    const multiKeys = new Set(["bank-statement-transactions", "purchase-order-lines"]);
    for (const preset of PRESET_TEMPLATES) {
      expect(preset.extractMultiple).toBe(multiKeys.has(preset.key));
    }
  });

  it("has non-empty name, description, and prompt for every preset", () => {
    for (const preset of PRESET_TEMPLATES) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.description.trim().length).toBeGreaterThan(0);
      expect(preset.prompt.trim().length).toBeGreaterThan(0);
    }
  });
});
