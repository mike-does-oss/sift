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
    const { ranges } = computeMatchRanges(text, results);

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
    const { ranges } = computeMatchRanges(text, results);
    // Only one span in the text can be claimed — the third row's search
    // (starting after row 1's match) finds nothing and falls back to the
    // same first occurrence row 0 already claimed, so overlap resolution
    // keeps exactly one mark rather than dropping the value entirely.
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    expect(ranges[0].row).toBe(0);
    expect(slice(text, ranges[0])).toBe("Acme Corp");
  });
});

describe("computeMatchRanges — quote-aware anchoring (grounded extraction, T2)", () => {
  it("quote match takes precedence over value matching when both could anchor", () => {
    // The bare value "100" could itself match plenty of places in this text;
    // the quote pins the anchor to the specific verbatim span the model read
    // it from instead of wherever value-matching would have landed first.
    const text = "Line 1: qty 100 @ $5 = 100.00 subtotal";
    const results = { amount: 100 };
    const quotes = { amount: "100.00" };
    const { ranges, anchors } = computeMatchRanges(text, results, quotes);

    expect(ranges).toHaveLength(1);
    expect(slice(text, ranges[0])).toBe("100.00");
    expect(ranges[0].start).toBe(text.indexOf("100.00"));
    expect(anchors).toEqual([{ field: "amount", row: 0, anchored: true }]);
  });

  it("quote anchors a value that value-matching could never find on its own", () => {
    // "1,320" (the grouped form of 1320) would normally satisfy the
    // word-boundary guard against "1,320.00" (the char after is "."), but
    // here it's glued directly to a currency code ("AUD1,320.00") so the
    // *value*-based candidate fails the boundary check on its leading edge.
    // The quote is verbatim, so it still anchors via the boundary-bypass
    // fallback in findQuoteMatch.
    const text = "Total: AUD1,320.00 due on receipt";
    const results = { total: 1320 };
    const quotes = { total: "1,320.00" };

    const valueOnly = computeMatchRanges(text, results);
    expect(valueOnly.ranges).toHaveLength(0);
    expect(valueOnly.anchors).toEqual([{ field: "total", row: 0, anchored: false }]);

    const { ranges, anchors } = computeMatchRanges(text, results, quotes);
    expect(ranges).toHaveLength(1);
    expect(slice(text, ranges[0])).toBe("1,320.00");
    expect(anchors).toEqual([{ field: "total", row: 0, anchored: true }]);
  });

  it("advances a per-quote cursor so duplicate quotes across rows anchor their own occurrence", () => {
    const text = "Item A: 1,320.00\nItem B: 1,320.00\nItem C: 1,320.00";
    const results = [{ total: 1320 }, { total: 1320 }, { total: 1320 }];
    const quotes = [{ total: "1,320.00" }, { total: "1,320.00" }, { total: "1,320.00" }];

    const { ranges, anchors } = computeMatchRanges(text, results, quotes);
    expect(ranges).toHaveLength(3);
    const sorted = ranges.slice().sort((a, b) => a.row - b.row);
    expect(sorted.map((r) => r.start)).toEqual([
      text.indexOf("1,320.00"),
      text.indexOf("1,320.00", text.indexOf("1,320.00") + 1),
      text.lastIndexOf("1,320.00"),
    ]);
    expect(anchors.every((a) => a.anchored)).toBe(true);
  });

  it("falls back to value matching when the quote is null, absent, or not found in the text", () => {
    const text = "Vendor: Acme Corp — Total: 42 — Item: Widget";
    const results = { vendor: "Acme Corp", total: 42, extra: "Widget" };
    const quotes = { vendor: null, total: "nowhere in the text", /* extra: absent */ };

    const { ranges, anchors } = computeMatchRanges(text, results, quotes);
    const byField = Object.fromEntries(ranges.map((r) => [r.field, r]));

    // null quote -> falls back to value match
    expect(slice(text, byField.vendor)).toBe("Acme Corp");
    // quote present but not found in text -> falls back to value match
    expect(slice(text, byField.total)).toBe("42");
    // quote key absent entirely -> falls back to value match
    expect(slice(text, byField.extra)).toBe("Widget");

    expect(anchors.sort((a, b) => a.field.localeCompare(b.field))).toEqual([
      { field: "extra", row: 0, anchored: true },
      { field: "total", row: 0, anchored: true },
      { field: "vendor", row: 0, anchored: true },
    ]);
  });

  it("reports anchored: false when neither the quote nor the value can be found", () => {
    const text = "This document mentions nothing relevant.";
    const results = { total: 999, vendor: null };
    const quotes = { total: "not present anywhere" };

    const { ranges, anchors } = computeMatchRanges(text, results, quotes);
    expect(ranges).toHaveLength(0);
    // `vendor` is null — no anchor entry at all, matching "null values unchanged".
    expect(anchors).toEqual([{ field: "total", row: 0, anchored: false }]);
  });

  it("returns no ranges/anchors when text or results is missing, with or without quotes", () => {
    expect(computeMatchRanges("", { a: 1 }, { a: "1" })).toEqual({ ranges: [], anchors: [] });
    expect(computeMatchRanges("some text", null, { a: "1" })).toEqual({ ranges: [], anchors: [] });
  });

  it("does not let a short (<3 char) quote bypass the boundary guard — a bare digit inside a longer number stays unanchored", () => {
    // "5" only ever appears embedded in "2025" here — the boundary-checked
    // path correctly rejects it (isAlphanumeric on both sides), and because
    // the quote is only 1 char, the boundary-bypass fallback that a longer
    // verbatim quote would get doesn't apply either. Without the minimum
    // length guard this would have falsely anchored to the "5" in "2025".
    const text = "Filed in 2025, reference only.";
    const results = { code: "X" };
    const quotes = { code: "5" };

    const { ranges, anchors } = computeMatchRanges(text, results, quotes);
    expect(ranges).toHaveLength(0);
    expect(anchors).toEqual([{ field: "code", row: 0, anchored: false }]);
  });

  it("still anchors a short quote when it satisfies the boundary-checked path directly", () => {
    // Same 1-char quote, but this time it stands alone (punctuation on both
    // sides), so the boundary-checked path itself succeeds — no bypass
    // needed, and short quotes are never penalized when they're genuinely
    // word-bounded.
    const text = "Grade: 5 out of 5";
    const results = { grade: "5" };
    const quotes = { grade: "5" };

    const { ranges, anchors } = computeMatchRanges(text, results, quotes);
    expect(ranges).toHaveLength(1);
    expect(slice(text, ranges[0])).toBe("5");
    expect(ranges[0].start).toBe(text.indexOf("5"));
    expect(anchors).toEqual([{ field: "grade", row: 0, anchored: true }]);
  });
});
