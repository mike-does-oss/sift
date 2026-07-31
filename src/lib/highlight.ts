import type { ExtractionData } from "@/types";

/**
 * The verbatim matcher behind DocumentView's "Extracted text" anchoring
 * (playbook §13 signature feature): given the document text the model saw
 * and the extracted result(s), finds where each value appears verbatim in
 * the text so the UI can render `<mark>`s and jump result rows to their
 * source. Pure — no React, no DOM — so it's testable on its own (see
 * `src/lib/__tests__/highlight.test.ts`) and shared by DocumentView.
 */
export interface MatchRange {
  start: number;
  end: number;
  field: string;
  row: number;
}

/** String forms to search for, in priority order. Numbers also get a thousands-separated form so "1,234.56" in the source text still anchors to the numeric value 1234.56. */
export function candidateStrings(value: string | number | boolean): string[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    const plain = String(value);
    let grouped = plain;
    try {
      grouped = value.toLocaleString("en-US");
    } catch {
      grouped = plain;
    }
    return grouped !== plain ? [plain, grouped] : [plain];
  }
  return [String(value)];
}

function isAlphanumeric(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z0-9]/.test(ch);
}

/**
 * Word-boundary guard: a match is only valid if, on each side where the
 * candidate's own edge character is alphanumeric, the adjacent character in
 * the source text (if any) is NOT alphanumeric. Without this, a short value
 * like "IN" would falsely highlight inside "MAIN STREET", or "5" inside
 * "2025". `boundarySource` is the original-case text — position-for-position
 * identical to `lowerText` for the ASCII content this app deals with, so it
 * doubles as the boundary source for the case-insensitive pass too.
 */
function hasWordBoundary(boundarySource: string, start: number, end: number, candidate: string): boolean {
  const firstChar = candidate[0];
  const lastChar = candidate[candidate.length - 1];
  const before = start > 0 ? boundarySource[start - 1] : undefined;
  const after = end < boundarySource.length ? boundarySource[end] : undefined;
  if (isAlphanumeric(firstChar) && isAlphanumeric(before)) return false;
  if (isAlphanumeric(lastChar) && isAlphanumeric(after)) return false;
  return true;
}

/** First occurrence of `needle` in `haystack` at or after `fromIndex` that also satisfies the word-boundary guard — not just the first `indexOf` hit. */
function findBoundaryIndex(haystack: string, needle: string, boundarySource: string, fromIndex: number): number {
  let searchFrom = fromIndex;
  while (searchFrom <= haystack.length) {
    const idx = haystack.indexOf(needle, searchFrom);
    if (idx === -1) return -1;
    if (hasWordBoundary(boundarySource, idx, idx + needle.length, needle)) return idx;
    searchFrom = idx + 1;
  }
  return -1;
}

/** Case-sensitive exact match first, then case-insensitive fallback. No fuzzy matching. Both require a word boundary on any alphanumeric-edged side. Search starts at `fromIndex` (default 0) so callers can find the *next* occurrence of a repeated value — see SF6 in computeMatchRanges. */
export function findFirstMatch(
  text: string,
  lowerText: string,
  value: string | number | boolean,
  fromIndex = 0
): { start: number; end: number } | null {
  const candidates = candidateStrings(value).filter((c) => c.length > 0);
  for (const c of candidates) {
    const idx = findBoundaryIndex(text, c, text, fromIndex);
    if (idx !== -1) return { start: idx, end: idx + c.length };
  }
  for (const c of candidates) {
    const lower = c.toLowerCase();
    const idx = findBoundaryIndex(lowerText, lower, text, fromIndex);
    if (idx !== -1) return { start: idx, end: idx + lower.length };
  }
  return null;
}

export function computeMatchRanges(text: string, results: ExtractionData | null): MatchRange[] {
  if (!text || !results) return [];
  const rows = Array.isArray(results) ? results : [results];
  const lowerText = text.toLowerCase();
  const ranges: MatchRange[] = [];

  // Per-value search cursor (SF6): when the same value is shared by more than
  // one row/field (a repeated vendor name, date, currency — the common case
  // in table extractions), each subsequent occurrence in the text anchors
  // the *next* row instead of every row silently re-anchoring row 0's match
  // (which then got dropped anyway by the overlap resolution below, leaving
  // rows 1..N with no mark and a dead crosshair). Keyed on the raw item's
  // type+value, not the matched candidate string, so `100` and `"100"` don't
  // share a cursor.
  const cursors = new Map<string, number>();

  rows.forEach((row, rowIndex) => {
    for (const [field, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue;
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") continue;
        if (item === "") continue;

        const cursorKey = `${typeof item}:${item}`;
        const cursor = cursors.get(cursorKey) ?? 0;
        let match = findFirstMatch(text, lowerText, item, cursor);
        // Fewer occurrences in the text than rows that need one — fall back
        // to the first occurrence rather than leaving this row unanchored.
        if (!match && cursor > 0) {
          match = findFirstMatch(text, lowerText, item, 0);
        }
        if (match) {
          cursors.set(cursorKey, match.end);
          ranges.push({ ...match, field, row: rowIndex });
        }
      }
    }
  });

  // Resolve overlaps (e.g. two fields sharing a value, or a fallback match
  // landing on a span another row already claimed) by keeping whichever
  // match starts first, so marks never nest.
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const nonOverlapping: MatchRange[] = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start >= lastEnd) {
      nonOverlapping.push(r);
      lastEnd = r.end;
    }
  }
  return nonOverlapping;
}
