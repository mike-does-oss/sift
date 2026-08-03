import { describe, it, expect } from "vitest";
import { validateExamples, MAX_TEMPLATE_EXAMPLES, MAX_TEMPLATE_EXAMPLES_BYTES } from "../template-examples";

describe("validateExamples", () => {
  it("treats undefined as absent", () => {
    expect(validateExamples(undefined)).toEqual({ ok: true, examples: undefined });
  });

  // B1 regression: drizzle round-trips a nullable `templates.examples`
  // column as `null`, not `undefined` — every template saved before this
  // field existed (or saved without examples) hits this branch.
  it("treats null as absent, same as undefined", () => {
    expect(validateExamples(null)).toEqual({ ok: true, examples: undefined });
  });

  it("passes through a valid examples array", () => {
    const raw = [{ output: { vendor: "Acme", total: 42 } }, { output: { vendor: "Globex" } }];
    expect(validateExamples(raw)).toEqual({ ok: true, examples: raw });
  });

  it("accepts an empty array", () => {
    expect(validateExamples([])).toEqual({ ok: true, examples: [] });
  });

  it("rejects a non-array", () => {
    expect(validateExamples({ output: {} }).ok).toBe(false);
    expect(validateExamples("nope").ok).toBe(false);
    expect(validateExamples(42).ok).toBe(false);
    const result = validateExamples("nope");
    expect(result).toEqual({ ok: false, error: "examples must be an array" });
  });

  it(`rejects more than ${MAX_TEMPLATE_EXAMPLES} entries`, () => {
    const raw = Array.from({ length: MAX_TEMPLATE_EXAMPLES + 1 }, () => ({ output: { a: 1 } }));
    expect(validateExamples(raw)).toEqual({
      ok: false,
      error: `examples must be ${MAX_TEMPLATE_EXAMPLES} or fewer`,
    });
  });

  it(`accepts exactly ${MAX_TEMPLATE_EXAMPLES} entries`, () => {
    const raw = Array.from({ length: MAX_TEMPLATE_EXAMPLES }, () => ({ output: { a: 1 } }));
    expect(validateExamples(raw).ok).toBe(true);
  });

  it("rejects an entry that isn't a plain object (array)", () => {
    expect(validateExamples([["not", "an", "object"]])).toEqual({
      ok: false,
      error: "each example must be an object of the form { output: {...} }",
    });
  });

  it("rejects an entry that isn't a plain object (string/number/null)", () => {
    expect(validateExamples(["nope"]).ok).toBe(false);
    expect(validateExamples([42]).ok).toBe(false);
    expect(validateExamples([null]).ok).toBe(false);
  });

  it("rejects a non-object output (array)", () => {
    expect(validateExamples([{ output: [1, 2] }])).toEqual({
      ok: false,
      error: "each example's `output` must be a plain object",
    });
  });

  it("rejects a non-object output (null/string/number)", () => {
    expect(validateExamples([{ output: null }]).ok).toBe(false);
    expect(validateExamples([{ output: "nope" }]).ok).toBe(false);
    expect(validateExamples([{ output: 42 }]).ok).toBe(false);
  });

  it("rejects an entry missing `output` entirely", () => {
    expect(validateExamples([{}]).ok).toBe(false);
  });

  // Byte cap (S5 / item 3): bounds the combined size of every example's
  // `output`, since that's what gets inlined into every prompt for the
  // template via buildExamplesBlock.
  it(`accepts exactly ${MAX_TEMPLATE_EXAMPLES_BYTES} combined bytes`, () => {
    // JSON.stringify({ a: "x".repeat(k) }).length === 8 + k, so k = 8184
    // lands exactly on the 8192 boundary.
    const output = { a: "x".repeat(8184) };
    expect(JSON.stringify(output).length).toBe(MAX_TEMPLATE_EXAMPLES_BYTES);
    expect(validateExamples([{ output }])).toEqual({ ok: true, examples: [{ output }] });
  });

  it(`rejects ${MAX_TEMPLATE_EXAMPLES_BYTES + 1} combined bytes`, () => {
    const output = { a: "x".repeat(8185) };
    expect(JSON.stringify(output).length).toBe(MAX_TEMPLATE_EXAMPLES_BYTES + 1);
    expect(validateExamples([{ output }])).toEqual({
      ok: false,
      error: "Examples are too large — keep them under 8KB combined.",
    });
  });

  it("sums bytes across multiple examples, not just the largest one", () => {
    // Two examples individually under the cap but over it combined.
    const output = { a: "x".repeat(5000) };
    expect(validateExamples([{ output }, { output }])).toEqual({
      ok: false,
      error: "Examples are too large — keep them under 8KB combined.",
    });
  });
});
