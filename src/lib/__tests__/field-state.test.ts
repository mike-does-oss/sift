import { describe, it, expect } from "vitest";
import { DEFAULT_FIELDS, isDefaultFieldState } from "../field-state";
import type { ExtractionField } from "@/types";

// The confirm-before-replace bar shared by the scaffold flow and template
// loading: only the untouched starter field may be replaced silently.
describe("isDefaultFieldState", () => {
  it("is true for the untouched starter field", () => {
    expect(isDefaultFieldState(DEFAULT_FIELDS)).toBe(true);
    // …including a copy with a different id (ids are generation-time noise)
    expect(isDefaultFieldState([{ id: "field-99", name: "name", type: "text" }])).toBe(true);
  });

  it("is false once the user has touched anything — so loading a template must confirm first", () => {
    const renamed: ExtractionField[] = [{ id: "field-1", name: "vendor", type: "text" }];
    const retyped: ExtractionField[] = [{ id: "field-1", name: "name", type: "number" }];
    const described: ExtractionField[] = [{ id: "field-1", name: "name", type: "text", description: "the full name" }];
    const added: ExtractionField[] = [...DEFAULT_FIELDS, { id: "field-2", name: "total", type: "number" }];
    const cleared: ExtractionField[] = [];
    for (const fields of [renamed, retyped, described, added, cleared]) {
      expect(isDefaultFieldState(fields)).toBe(false);
    }
  });
});
