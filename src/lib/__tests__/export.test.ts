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

  describe("formula-injection escaping", () => {
    it.each([
      ["=1+2", "'=1+2"],
      ["+SUM(A1:A2)", "'+SUM(A1:A2)"],
      ["-2+3", "'-2+3"],
      ["@cmd", "'@cmd"],
    ])("prefixes %s with an apostrophe", (input, expected) => {
      expect(toCsv([{ a: input }])).toBe(`a\n${expected}`);
    });

    it("neutralizes leading tab and CR (and the quoting still applies)", () => {
      expect(toCsv([{ a: "\tcmd" }])).toBe("a\n'\tcmd");
      // CR-prefixed value: apostrophe first, then the existing quote rule
      // does NOT fire (only \" , \\n trigger quoting) — pinned as-is.
      expect(toCsv([{ a: "\rcmd" }])).toBe("a\n'\rcmd");
    });

    it("escapes formulas that also need quoting", () => {
      expect(toCsv([{ a: '=HYPERLINK("http://x")' }])).toBe('a\n"\'=HYPERLINK(""http://x"")"');
    });

    it("leaves ordinary values (including numbers and interior symbols) untouched", () => {
      expect(toCsv([{ a: 12, b: "a=b", c: "x@y.z", d: "plain" }])).toBe("a,b,c,d\n12,a=b,x@y.z,plain");
    });

    it("escapes a joined array whose first item starts a formula", () => {
      expect(toCsv([{ a: ["=x", "y"] }])).toBe("a\n'=x; y");
    });
  });
});
