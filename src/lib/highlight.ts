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

/** Per-field/row anchor status — one entry for every field/row whose value is non-null, whether or not a `<mark>` was produced for it. Lets callers (e.g. ResultsDisplay's "not found in source" hint) distinguish "no anchor because the value is absent" from "anchor was attempted but nothing matched verbatim". */
export interface FieldAnchor {
  field: string;
  row: number;
  anchored: boolean;
}

export interface MatchComputation {
  ranges: MatchRange[];
  anchors: FieldAnchor[];
}

/** Source quotes for one row, keyed by field name — `null` (or absent) means the engine didn't ground that field. Mirrors `ExtractionOutput.quotes`'s per-row shape (`src/lib/extraction/types.ts`). */
export type QuoteRow = Record<string, string | null | undefined>;

/** Single-row form (object) or multi-row form (array), matching `ExtractionOutput.quotes` / `ExtractionData`'s own single-vs-array shape. */
export type Quotes = QuoteRow | QuoteRow[];

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

/**
 * Below this length, a quote is too short for the boundary-bypass fallback
 * below to be trustworthy — see `findQuoteMatch`.
 */
const MIN_BYPASS_QUOTE_LENGTH = 3;

/**
 * Exact quote match: quotes are copied verbatim by the model (see
 * `QUOTE_INSTRUCTION` in `src/lib/extraction/types.ts`), so unlike
 * `findFirstMatch` there's no case-insensitive fallback and no candidate
 * expansion — just `indexOf`. The word-boundary guard is still tried first
 * (cheap, and correct in the common case), and a plain `indexOf` hit can win
 * even where the guard would reject it — but only for quotes at least
 * `MIN_BYPASS_QUOTE_LENGTH` chars long. A full multi-character verbatim
 * quote is strong enough evidence on its own that the boundary heuristic
 * (tuned to stop short user-entered values like "5" or "IN" from matching
 * mid-word) would only produce false negatives for it. A 1-2 char quote
 * doesn't carry that same evidentiary weight — "5" bypassing the boundary
 * guard would happily anchor to the "5" inside "2025" — so short quotes get
 * no bypass: they anchor only via the boundary-checked path, or not at all.
 */
function findQuoteMatch(text: string, quote: string, fromIndex: number): { start: number; end: number } | null {
  const boundaryIdx = findBoundaryIndex(text, quote, text, fromIndex);
  if (boundaryIdx !== -1) return { start: boundaryIdx, end: boundaryIdx + quote.length };
  if (quote.length < MIN_BYPASS_QUOTE_LENGTH) return null;
  const plainIdx = text.indexOf(quote, fromIndex);
  if (plainIdx !== -1) return { start: plainIdx, end: plainIdx + quote.length };
  return null;
}

/**
 * Anchors every field/row's value in `text`, quote-aware. Precedence per
 * field/row (see "Anchoring precedence", `docs/plans/2026-08-03-grounded-extraction.md`):
 *   (a) exact quote match, if `quotes` supplies one for this field/row —
 *       verbatim `indexOf`, with a duplicate-quote cursor so repeated quotes
 *       across rows each anchor their own occurrence (mirrors SF6 below).
 *   (b) existing value-derived matching (candidate strings, word-boundary
 *       guard, per-value cursor) — unchanged, and the fallback whenever (a)
 *       doesn't apply (quote null/absent/not found in the text).
 *   (c) neither anchors → the field/row is reported `anchored: false` so UI
 *       callers can render an "unverified" hint (ResultsDisplay) without
 *       having to re-derive match state themselves.
 * Returns both the flat `ranges` (for `<mark>` rendering, as before) and the
 * per-field/row `anchors` (new) — one entry per non-null value, regardless
 * of whether it anchored.
 */
export function computeMatchRanges(text: string, results: ExtractionData | null, quotes?: Quotes): MatchComputation {
  if (!text || !results) return { ranges: [], anchors: [] };
  const rows = Array.isArray(results) ? results : [results];
  // Only trust `quotes` when its array-ness matches `results`' — a single
  // QuoteRow aligns with a single-object `results`, an array aligns
  // per-index with multi-row `results`. A shape mismatch (contract
  // violation upstream) falls back to no quotes rather than misaligning
  // row 0's quotes onto every row.
  const quoteRows: QuoteRow[] = Array.isArray(quotes) ? quotes : quotes && !Array.isArray(results) ? [quotes] : [];
  const lowerText = text.toLowerCase();
  const ranges: MatchRange[] = [];
  const anchors: FieldAnchor[] = [];

  // Per-value search cursor (SF6): when the same value is shared by more than
  // one row/field (a repeated vendor name, date, currency — the common case
  // in table extractions), each subsequent occurrence in the text anchors
  // the *next* row instead of every row silently re-anchoring row 0's match
  // (which then got dropped anyway by the overlap resolution below, leaving
  // rows 1..N with no mark and a dead crosshair). Keyed on the raw item's
  // type+value, not the matched candidate string, so `100` and `"100"` don't
  // share a cursor.
  const valueCursors = new Map<string, number>();
  // Same idea, keyed on the quote text itself, so duplicate quotes across
  // rows (e.g. the same line item total repeated) each claim their own
  // occurrence too.
  const quoteCursors = new Map<string, number>();

  rows.forEach((row, rowIndex) => {
    const quoteRow = quoteRows[rowIndex];
    for (const [field, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue;
      let anchored = false;

      const quote = quoteRow?.[field];
      if (typeof quote === "string" && quote.length > 0) {
        const cursor = quoteCursors.get(quote) ?? 0;
        let match = findQuoteMatch(text, quote, cursor);
        if (!match && cursor > 0) {
          match = findQuoteMatch(text, quote, 0);
        }
        if (match) {
          quoteCursors.set(quote, match.end);
          ranges.push({ ...match, field, row: rowIndex });
          anchored = true;
        }
      }

      if (!anchored) {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
          if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") continue;
          if (item === "") continue;

          const cursorKey = `${typeof item}:${item}`;
          const cursor = valueCursors.get(cursorKey) ?? 0;
          let match = findFirstMatch(text, lowerText, item, cursor);
          // Fewer occurrences in the text than rows that need one — fall back
          // to the first occurrence rather than leaving this row unanchored.
          if (!match && cursor > 0) {
            match = findFirstMatch(text, lowerText, item, 0);
          }
          if (match) {
            valueCursors.set(cursorKey, match.end);
            ranges.push({ ...match, field, row: rowIndex });
            anchored = true;
          }
        }
      }

      anchors.push({ field, row: rowIndex, anchored });
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
  return { ranges: nonOverlapping, anchors };
}
