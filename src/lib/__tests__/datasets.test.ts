import { describe, it, expect } from "vitest";
import { headersMatch, rowsForHeaders } from "../datasets";

describe("headersMatch", () => {
  it("matches identical header sets", () => {
    expect(headersMatch(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("matches regardless of order", () => {
    expect(headersMatch(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("rejects a subset", () => {
    expect(headersMatch(["a", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("rejects a superset", () => {
    expect(headersMatch(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(headersMatch(["a", "B"], ["a", "b"])).toBe(false);
  });
});

describe("rowsForHeaders", () => {
  it("projects missing keys to null", () => {
    const result = rowsForHeaders([{ a: 1 }], ["a", "b"]);
    expect(result).toEqual([{ a: 1, b: null }]);
  });

  it("drops extra keys not in headers", () => {
    const result = rowsForHeaders([{ a: 1, b: 2, c: 3 }], ["a", "b"]);
    expect(result).toEqual([{ a: 1, b: 2 }]);
  });

  it("preserves header order in the returned keys", () => {
    const result = rowsForHeaders([{ b: 2, a: 1 }], ["a", "b"]);
    expect(Object.keys(result[0])).toEqual(["a", "b"]);
  });

  it("handles multiple rows independently", () => {
    const result = rowsForHeaders(
      [{ a: 1, extra: "x" }, { b: 2 }],
      ["a", "b"]
    );
    expect(result).toEqual([{ a: 1, b: null }, { a: null, b: 2 }]);
  });

  it("handles an empty rows array", () => {
    expect(rowsForHeaders([], ["a", "b"])).toEqual([]);
  });
});
