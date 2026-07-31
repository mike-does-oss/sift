import { describe, it, expect } from "vitest";
import { computeMatchRanges, findFirstMatch } from "../highlight";

function slice(text: string, r: { start: number; end: number }) {
  return text.slice(r.start, r.end);
}

describe("findFirstMatch — word boundary guard", () => {
  it("rejects a short value found only inside a longer alphanumeric run", () => {
    const text = "MAIN STREET";
    expect(findFirstMatch(text, text.toLowerCase(), "IN")).toBeNull();
    const yearText = "Filed in 2025";
    expect(findFirstMatch(yearText, yearText.toLowerCase(), "5")).toBeNull();
  });

  it("matches a value at the very start and at the very end of the text", () => {
    const text = "Acme Corp,total due";
    const startMatch = findFirstMatch(text, text.toLowerCase(), "Acme Corp");
    expect(startMatch).toEqual({ start: 0, end: 9 });

    const endText = "Balance: $99.00";
    const endMatch = findFirstMatch(endText, endText.toLowerCase(), "$99.00");
    expect(endMatch).toEqual({ start: 9, end: endText.length });
  });

  it("matches a value edged by punctuation (not alphanumeric, so the boundary is satisfied)", () => {
    const text = "Total due: $42.50, thanks";
    const match = findFirstMatch(text, text.toLowerCase(), "$42.50");
    expect(match).not.toBeNull();
    expect(slice(text, match!)).toBe("$42.50");
  });

  it("falls back to a case-insensitive match when no case-sensitive one exists", () => {
    const text = "invoice from ACME CORP dated today";
    const match = findFirstMatch(text, text.toLowerCase(), "Acme Corp");
    expect(match).not.toBeNull();
    expect(slice(text, match!)).toBe("ACME CORP");
  });

  it("matches a plain number against its thousands-separated form in the source", () => {
    const text = "Grand total: 1,234.56 USD";
    const match = findFirstMatch(text, text.toLowerCase(), 1234.56);
    expect(match).not.toBeNull();
    expect(slice(text, match!)).toBe("1,234.56");
  });
});

describe("computeMatchRanges — repeated values anchor per row (SF6)", () => {
  it("advances subsequent duplicate-value rows to their own occurrence in the text", () => {
    const text = "Vendor: Acme Corp\nLine 1 total 100\nVendor: Acme Corp\nLine 2 total 250.5";
    const results = [
      { vendor: "Acme Corp", amount: 100 },
      { vendor: "Acme Corp", amount: 250.5 },
    ];
    const ranges = computeMatchRanges(text, results);

    const vendorRanges = ranges.filter((r) => r.field === "vendor").sort((a, b) => a.row - b.row);
    expect(vendorRanges).toHaveLength(2);
    expect(vendorRanges[0].row).toBe(0);
    expect(vendorRanges[1].row).toBe(1);
    // Each row's mark anchors a *different* occurrence in the text.
    expect(vendorRanges[0].start).not.toBe(vendorRanges[1].start);
    expect(slice(text, vendorRanges[0])).toBe("Acme Corp");
    expect(slice(text, vendorRanges[1])).toBe("Acme Corp");

    const amountRanges = ranges.filter((r) => r.field === "amount");
    expect(amountRanges).toHaveLength(2);
  });

  it("falls back to the first occurrence when the text has fewer occurrences than rows", () => {
    const text = "Vendor: Acme Corp only appears once here";
    const results = [
      { vendor: "Acme Corp" },
      { vendor: "Acme Corp" },
      { vendor: "Acme Corp" },
    ];
    const ranges = computeMatchRanges(text, results);
    // Only one span in the text can be claimed — the third row's search
    // (starting after row 1's match) finds nothing and falls back to the
    // same first occurrence row 0 already claimed, so overlap resolution
    // keeps exactly one mark rather than dropping the value entirely.
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    expect(ranges[0].row).toBe(0);
    expect(slice(text, ranges[0])).toBe("Acme Corp");
  });
});
