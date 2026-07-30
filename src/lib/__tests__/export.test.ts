import { describe, it, expect } from "vitest";
import { toCsv } from "../export";

describe("toCsv", () => {
  it("unions headers and escapes", () => {
    const csv = toCsv([{ a: 1, b: 'say "hi"' }, { a: 2, c: ["x", "y"] }]);
    expect(csv.split("\n")[0]).toBe("a,b,c");
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain("x; y");
  });
  it("handles empty", () => expect(toCsv([])).toBe(""));
});
