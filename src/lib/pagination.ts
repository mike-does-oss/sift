/**
 * Pure pagination math shared by the results table (`ResultsDisplay`) and the
 * dataset detail page's rows table (§13, "paginate long results tables").
 * Deliberately dumb: every function is a one-liner over `rowCount`/`page` —
 * the correctness this task is actually about (edits keyed by absolute row
 * index, exports/saves using all rows, flashCell paging to the right page)
 * lives in the callers, not here. Pages are 1-indexed throughout, matching
 * the "1–25 of 137" display convention.
 */

export const PAGE_SIZE = 25;

/** Total 1-indexed pages for `rowCount` rows. Always >= 1 (even for 0 rows) so callers can treat page 1 as always valid — an empty table is still "page 1 of 1", not "page 1 of 0". */
export function pageCount(rowCount: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(rowCount / pageSize));
}

/** Clamps a (possibly stale) 1-indexed page into `[1, pageCount(rowCount, pageSize)]` — e.g. after a delete shrinks `rowCount` out from under the page the user was on. */
export function clampPage(page: number, rowCount: number, pageSize: number = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(rowCount, pageSize));
}

export interface PageSlice {
  /** 0-indexed, inclusive — the absolute row index of the first row on this page. */
  startIndex: number;
  /** 0-indexed, exclusive — pass straight to `Array.prototype.slice`. */
  endIndex: number;
}

/** Absolute `[startIndex, endIndex)` slice bounds for `page` (1-indexed; callers should pass an already-clamped page). */
export function pageSlice(page: number, rowCount: number, pageSize: number = PAGE_SIZE): PageSlice {
  const startIndex = Math.min((page - 1) * pageSize, rowCount);
  const endIndex = Math.min(startIndex + pageSize, rowCount);
  return { startIndex, endIndex };
}

/** The 1-indexed page a given absolute row index falls on — how `flashCell` decides whether it needs to switch pages before flashing a cell. */
export function pageForRow(rowIndex: number, pageSize: number = PAGE_SIZE): number {
  return Math.floor(rowIndex / pageSize) + 1;
}

/** "1–25 of 137" pager label (1-indexed, inclusive both ends); "0 of 0" for an empty set. */
export function pageRangeLabel(page: number, rowCount: number, pageSize: number = PAGE_SIZE): string {
  if (rowCount === 0) return "0 of 0";
  const { startIndex, endIndex } = pageSlice(page, rowCount, pageSize);
  return `${startIndex + 1}–${endIndex} of ${rowCount}`;
}
