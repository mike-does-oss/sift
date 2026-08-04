import { describe, it, expect } from "vitest";
import { PAGE_SIZE, pageCount, clampPage, pageSlice, pageForRow, pageRangeLabel } from "../pagination";

describe("pageCount", () => {
  it("is always at least 1, even for zero rows", () => {
    expect(pageCount(0)).toBe(1);
  });
  it("divides evenly at the boundary", () => {
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(pageCount(50)).toBe(2);
    expect(pageCount(51)).toBe(3);
  });
  it("respects a custom page size", () => {
    expect(pageCount(10, 5)).toBe(2);
  });
});

describe("clampPage", () => {
  it("clamps below 1 up to 1", () => {
    expect(clampPage(0, 137)).toBe(1);
    expect(clampPage(-5, 137)).toBe(1);
  });
  it("clamps above the last page down to the last page", () => {
    expect(clampPage(999, 137)).toBe(6); // ceil(137/25) = 6
  });
  it("passes through an already-valid page unchanged", () => {
    expect(clampPage(3, 137)).toBe(3);
  });
  it("clamps down when rowCount shrinks out from under the page (e.g. a row delete)", () => {
    // was on page 6 of a 137-row set; a delete drops it to 125 rows (5 pages)
    expect(clampPage(6, 125)).toBe(5);
  });
});

describe("pageSlice", () => {
  it("slices the first page", () => {
    expect(pageSlice(1, 137)).toEqual({ startIndex: 0, endIndex: 25 });
  });
  it("slices a middle page", () => {
    expect(pageSlice(2, 137)).toEqual({ startIndex: 25, endIndex: 50 });
  });
  it("slices a partial last page", () => {
    expect(pageSlice(6, 137)).toEqual({ startIndex: 125, endIndex: 137 });
  });
  it("never overruns rowCount even for an out-of-range page", () => {
    expect(pageSlice(999, 137)).toEqual({ startIndex: 137, endIndex: 137 });
  });
  it("handles zero rows", () => {
    expect(pageSlice(1, 0)).toEqual({ startIndex: 0, endIndex: 0 });
  });
});

describe("pageForRow", () => {
  it("maps row 0 to page 1", () => {
    expect(pageForRow(0)).toBe(1);
  });
  it("maps the last row of page 1 to page 1", () => {
    expect(pageForRow(PAGE_SIZE - 1)).toBe(1);
  });
  it("maps the first row of page 2 to page 2", () => {
    expect(pageForRow(PAGE_SIZE)).toBe(2);
  });
  it("maps an absolute row deep in a large set to the right page", () => {
    expect(pageForRow(136)).toBe(6); // row 136 (0-indexed) -> 137th row -> page 6
  });
});

describe("pageRangeLabel", () => {
  it("formats the first page of a large set", () => {
    expect(pageRangeLabel(1, 137)).toBe("1–25 of 137");
  });
  it("formats a partial last page", () => {
    expect(pageRangeLabel(6, 137)).toBe("126–137 of 137");
  });
  it("formats a single full page", () => {
    expect(pageRangeLabel(1, 25)).toBe("1–25 of 25");
  });
  it("formats an empty set", () => {
    expect(pageRangeLabel(1, 0)).toBe("0 of 0");
  });
});
