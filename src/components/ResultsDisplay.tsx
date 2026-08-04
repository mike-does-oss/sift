"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, Download, AlertCircle, Loader2, RotateCcw, Crosshair, Maximize2, X } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { ExtractionField, ExtractionData, ExtractionResult } from "@/types";
import { toCsv, downloadText } from "@/lib/export";
import { computeMatchRanges, type Quotes } from "@/lib/highlight";
import { fieldColorVars } from "@/lib/fieldColors";
import { prefersReducedMotion } from "@/lib/motion";
import { PAGE_SIZE, clampPage, pageForRow, pageSlice } from "@/lib/pagination";
import { PaginationBar } from "./PaginationBar";

export interface ResultsDisplayHandle {
  /** Reverse of DocumentView's scrollToMark — scrolls the matching cell into view and briefly flashes it. Called when a document mark is clicked. No-op if the field/row isn't currently rendered (e.g. a stale row after edits). */
  flashCell: (fieldName: string, rowIndex: number) => void;
}

type FieldValue = string | number | boolean | string[] | null;

interface ResultsDisplayProps {
  /** Original extracted values (immutable per extraction) — the reset target and the "edited" diff baseline. */
  results: ExtractionData | null;
  fields: ExtractionField[];
  isLoading: boolean;
  error: string | null;
  /** Scrolls the value's first anchor mark into view in the document pane, if it appears verbatim in the text. */
  onJumpToValue?: (fieldName: string, rowIndex: number) => void;
  /**
   * The document text the model saw, from the extract response — undefined
   * for images. Only used to compute the "not found in source" hint below;
   * pass it whenever `onJumpToValue`'s same availability rule (extracted-text
   * view exists) is met, undefined otherwise so no hint is computed.
   */
  extractedText?: string;
  /** Per-field/row source quotes from a grounded extraction — undefined when the engine/response didn't ground. */
  quotes?: Quotes;
  /** The field currently hovered in either pane (lifted to DashboardPage). `null` when nothing is hovered — drives the column tint below. */
  hoveredField?: string | null;
  /** Reports hover in/out of a results cell, by field name (`null` on leave) — the other half of the two-way link with DocumentView's marks. Only called while highlighting is live (see `highlightsLive` below); a plain table with no document pane has nothing to link to. */
  onHoverField?: (field: string | null) => void;
  /**
   * Fires after every edit (and reset-to-extracted) with the full, current
   * edited working copy — ALL rows, not just the visible page. The
   * save-to-dataset panel lives outside this component now (§13, "separate
   * save-to-dataset from results") but still needs live edited values, so
   * the parent mirrors this into its own state and hands it down as that
   * panel's `rows` prop. Not called on mount or on a new-extraction reset
   * (results reference change) — the parent already has the fresh `results`
   * itself at that point and can derive the reset rows without a round trip.
   */
  onEditedRowsChange?: (rows: ExtractionResult[]) => void;
  /**
   * Pre-formatted "Extracted with <provider> · <model>" line — the parent
   * (dashboard page) already computes this from its own provider list for
   * the caption above this component; passed through only so the expand
   * modal's header (§13, "expand-to-modal" task) can show the same line
   * without this component needing to know about providers itself.
   * Undefined renders no line, same as the parent's own caption.
   */
  providerModelLabel?: string;
}

function valuesEqual(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function stringify(value: FieldValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Mono inline editor for one extracted value. Short scalar values get a text
 * input; long or array values get a textarea (arrays shown/edited as JSON).
 * Booleans get a constrained true/false select (no invalid state possible).
 * Numbers and arrays validate on commit like each other: invalid input is
 * never silently coerced to a string or discarded — it's flagged and the
 * last valid value is kept until the draft is fixed.
 */
function EditableValue({
  value,
  onCommit,
}: {
  value: FieldValue;
  onCommit: (next: FieldValue) => void;
}) {
  const isArrayVal = Array.isArray(value);
  const isBooleanVal = typeof value === "boolean";
  const isNumberVal = typeof value === "number";
  const initial = stringify(value);
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  // Resync from the outside (new extraction, or a "reset to extracted" click)
  // without clobbering the draft on every unrelated parent re-render: adjust
  // state during render when the incoming value actually changed, rather
  // than in an effect (see https://react.dev/learn/you-might-not-need-an-effect).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setDraft(initial);
    setInvalid(false);
  }

  const isLong = !isArrayVal && (draft.length > 60 || draft.includes("\n"));

  const commit = (text: string) => {
    if (isArrayVal) {
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
        setInvalid(false);
        onCommit(parsed.map((v) => String(v)));
      } catch {
        // Keep the draft so the user doesn't lose their edit; just don't commit yet.
        setInvalid(true);
      }
      return;
    }
    if (isNumberVal) {
      const trimmed = text.trim();
      const n = Number(trimmed);
      if (trimmed !== "" && Number.isFinite(n)) {
        setInvalid(false);
        onCommit(n);
      } else {
        // Keep the draft (and the last-committed numeric value) — don't
        // silently degrade the field to a string, mirroring the array path.
        setInvalid(true);
      }
      return;
    }
    setInvalid(false);
    onCommit(text);
  };

  // Dense/instrument-style cell styling (§13, "denser results table" task):
  // borderless-until-interaction so the table reads as a tight grid rather
  // than a stack of boxed inputs — no persistent input background competing
  // with the row's own hover background, border only appears on hover/focus
  // (or permanently, for the invalid state, which must stay legible either way).
  const fieldClasses = (extra: string) =>
    `data w-full rounded-md text-[13px] leading-tight text-[var(--text-primary)] border bg-transparent transition-colors focus:outline-none ${
      invalid
        ? "border-[var(--error)]"
        : "border-transparent hover:border-[var(--border-subtle)] focus:border-[var(--accent-muted)] focus:bg-[var(--surface-elevated)]"
    } ${extra}`;

  // Booleans are constrained to true/false — no free text, so no invalid state is reachable.
  if (isBooleanVal) {
    return (
      <select
        value={value ? "true" : "false"}
        onChange={(e) => onCommit(e.target.value === "true")}
        className={fieldClasses("px-1.5 py-1")}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (isArrayVal || isLong) {
    return (
      <div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          spellCheck={false}
          rows={Math.min(Math.max(draft.split("\n").length, 2), 6)}
          className={fieldClasses("px-1.5 py-1 resize-y")}
        />
        {invalid && <p className="text-[10px] text-[var(--error)] mt-0.5">Invalid JSON — not saved yet</p>}
      </div>
    );
  }

  return (
    <div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        spellCheck={false}
        inputMode={isNumberVal ? "decimal" : undefined}
        className={fieldClasses("px-1.5 py-1")}
      />
      {invalid && <p className="text-[10px] text-[var(--error)] mt-0.5">Invalid number — not saved yet</p>}
    </div>
  );
}

/** Copy JSON / download CSV / download JSON — always export the EDITED values (see `edited` in ResultsDisplay). Reused verbatim in the expand modal's header (§13, "expand-to-modal" task) so both surfaces export identically. */
function ExportBar({
  copied,
  onCopy,
  onDownloadJson,
  onDownloadCsv,
}: {
  copied: boolean;
  onCopy: () => void;
  onDownloadJson: () => void;
  onDownloadCsv: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onCopy}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copied" : "Copy"}
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onDownloadCsv}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        CSV
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onDownloadJson}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        JSON
      </motion.button>
    </div>
  );
}

interface ResultsTableProps {
  fields: ExtractionField[];
  showIndexColumn: boolean;
  /** Full original extraction (unsliced) — used to diff each cell against for the "edited" dot/reset affordance. */
  resultsArray: ExtractionResult[];
  /** Only the current page's rows (already sliced by the caller). */
  pageRows: ExtractionResult[];
  /** Absolute row index of `pageRows[0]` — every per-row lookup below adds `i` to this, never uses the page-local index alone. */
  startIndex: number;
  anchoredMap: Map<string, boolean> | null;
  hoveredField: string | null;
  /** Undefined disables hover linking entirely (the expand modal instance — its document pane isn't visible, so there's nothing to link to). */
  onHoverField?: (field: string | null) => void;
  /** Undefined disables the jump-to-document crosshair (same modal-instance reasoning as `onHoverField`) — `highlightsLive` below is derived from this alone, so passing undefined also turns off swatches/column tinting. */
  onJumpToValue?: (fieldName: string, rowIndex: number) => void;
  updateField: (rowIndex: number, fieldName: string, value: FieldValue) => void;
  resetField: (rowIndex: number, fieldName: string) => void;
  flashTarget: { field: string; row: number; token: number } | null;
  /** Only the inline card instance wires this up (flashCell's querySelector scopes to it); the modal instance doesn't need one since its marks-in-document trigger can't fire while the modal covers the document pane. */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** Tailwind classes controlling the scroll container's height — a fixed `max-h-*` for the inline card, `flex-1 min-h-0` to fill the modal panel's remaining height. */
  scrollAreaClassName: string;
}

/**
 * The actual `<table>` — column headers, sticky on scroll, plus the editable
 * cell grid. Factored out of `ResultsDisplay` so the expand-to-modal task
 * (§13) can mount it a second time inside the modal: same props shape, same
 * `edited`/`page` state from the parent closure, so an edit made in either
 * instance is immediately visible in the other (they're rendering the same
 * data, not a copy) — see the modal-open effect below for why edit state
 * doesn't need any special persistence across open/close.
 */
function ResultsTable({
  fields,
  showIndexColumn,
  resultsArray,
  pageRows,
  startIndex,
  anchoredMap,
  hoveredField,
  onHoverField,
  onJumpToValue,
  updateField,
  resetField,
  flashTarget,
  containerRef,
  scrollAreaClassName,
}: ResultsTableProps) {
  // Colors/swatches/hover-linking only make sense once there's a document
  // pane with live marks to link to — same availability rule `onJumpToValue`
  // already encoded before this was factored out. The modal instance passes
  // `onJumpToValue={undefined}`, so it renders a plain (uncolored) table.
  const highlightsLive = Boolean(onJumpToValue);

  return (
    <div
      className={`overflow-x-auto overflow-y-auto ${scrollAreaClassName}`}
      ref={containerRef}
    >
      <table className="w-full text-sm">
        <thead>
          <tr>
            {showIndexColumn && (
              <th
                className="sticky top-0 z-10 bg-[var(--surface-inset)] border-b border-[var(--border-subtle)] px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)] w-8"
              >
                #
              </th>
            )}
            {fields.map((field, fieldIndex) => (
              <th
                key={field.id}
                // Type moved from an inline "· TYPE" suffix to a tooltip
                // (§13, "cleaner table headers" task) — the header now reads
                // as just the field name, type is a hover affordance.
                title={field.type}
                className="sticky top-0 z-10 bg-[var(--surface-inset)] border-b border-[var(--border-subtle)] px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
              >
                {highlightsLive && (
                  <span
                    aria-hidden="true"
                    className="field-swatch inline-block w-2 h-2 rounded-[2px] mr-1.5 align-middle"
                    style={fieldColorVars(fieldIndex) as CSSProperties}
                  />
                )}
                <span className="data text-[var(--text-secondary)]">{field.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, i) => {
            const rowIndex = startIndex + i;
            return (
              <tr
                key={rowIndex}
                className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface-overlay)]/30 transition-colors align-top"
              >
                {showIndexColumn && (
                  <td className="px-2 py-1 text-[13px] text-[var(--text-tertiary)] tabular-nums align-top">{rowIndex + 1}</td>
                )}
                {fields.map((field, fieldIndex) => {
                  const original = resultsArray[rowIndex]?.[field.name] ?? null;
                  const current = row[field.name] ?? null;
                  const isEdited = !valuesEqual(current, original);
                  // Non-null value, but neither its quote nor the value
                  // itself was found verbatim in the document text — a
                  // light trust signal, not a validation error (the value
                  // may still be correct; it just can't be verified against
                  // the source the way anchored cells can).
                  const unanchored =
                    anchoredMap !== null && original !== null && anchoredMap.get(`${rowIndex}:${field.name}`) === false;
                  // Column tint (two-way hover linking, LangExtract-style):
                  // this cell's field is the one currently hovered — either
                  // a mark in the document or another cell in this same
                  // column — so give it the field's own tinted background.
                  // Only lit up while highlighting is actually live.
                  const isHoveredColumn = highlightsLive && hoveredField === field.name;
                  const isFlashing = flashTarget?.field === field.name && flashTarget.row === rowIndex;
                  return (
                    <td
                      key={field.id}
                      data-field={field.name}
                      data-row={rowIndex}
                      style={highlightsLive ? (fieldColorVars(fieldIndex) as CSSProperties) : undefined}
                      onMouseEnter={() => {
                        if (highlightsLive) onHoverField?.(field.name);
                      }}
                      onMouseLeave={() => {
                        if (highlightsLive) onHoverField?.(null);
                      }}
                      className={`relative group/cell px-2 py-1 min-w-[9rem] align-top transition-colors ${
                        isHoveredColumn ? "field-tint" : ""
                      }`}
                      title={unanchored ? "Value not found verbatim in the document — verify manually" : undefined}
                    >
                      {isFlashing && flashTarget && (
                        <span key={flashTarget.token} aria-hidden="true" className="cell-flash-overlay" />
                      )}
                      <div
                        // Reserved clearance must be ≥ the overlay's actual
                        // footprint in the persistent (edited, unfocused)
                        // state: dot (12px) + crosshair button (16px) + reset
                        // button (16px) + two 2px gaps (4px) ≈ 48px, plus the
                        // overlay's own `right-1` offset (4px) ≈ 52px from
                        // the cell's right edge — pr-6 (24px) under-reserved
                        // this and let the icons cover the value's tail.
                        className={`${isEdited ? "pr-14" : "pr-1"} ${
                          unanchored ? "border-b border-dashed border-[var(--text-tertiary)]" : ""
                        }`}
                      >
                        <EditableValue value={current} onCommit={(v) => updateField(rowIndex, field.name, v)} />
                      </div>
                      {/* Edited indicator + reset + crosshair: compact,
                          icon-sized, and overlaid (not laid out in flow) so
                          they never permanently reserve column width — the
                          value area only makes room for them once the cell is
                          actually edited (the one case where they stay
                          visible); otherwise they float over the value's
                          trailing edge on hover/focus. */}
                      <div
                        className={`absolute top-1 right-1 flex items-center gap-0.5 transition-opacity ${
                          isEdited ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100"
                        }`}
                      >
                        {isEdited && (
                          <span
                            title={`${field.name} edited from the extracted value`}
                            className="flex items-center justify-center w-3 h-3"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                            <span className="sr-only">Edited</span>
                          </span>
                        )}
                        {onJumpToValue && (
                          <button
                            onClick={() => onJumpToValue(field.name, rowIndex)}
                            aria-label={`Jump to ${field.name} in document`}
                            title="Jump to highlight in document"
                            className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
                          >
                            <Crosshair className="w-3 h-3" />
                          </button>
                        )}
                        {isEdited && (
                          <button
                            onClick={() => resetField(rowIndex, field.name)}
                            aria-label={`Reset ${field.name} to extracted value`}
                            title="Reset to extracted value"
                            className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const ResultsDisplay = forwardRef<ResultsDisplayHandle, ResultsDisplayProps>(function ResultsDisplay(
  {
    results,
    fields,
    isLoading,
    error,
    onJumpToValue,
    extractedText,
    quotes,
    hoveredField = null,
    onHoverField,
    onEditedRowsChange,
    providerModelLabel,
  },
  ref
) {
  const [copied, setCopied] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // { field, row, token } identifies the currently-flashing cell; `token`
  // (bumped on every flashCell call) forces the flash overlay to remount —
  // and so restart its animation — even when the same cell is clicked twice
  // in a row, when the field/row string key alone wouldn't change.
  const [flashTarget, setFlashTarget] = useState<{ field: string; row: number; token: number } | null>(null);
  const flashTokenRef = useRef(0);
  // Working copy the user edits. Immutable updates only, so sharing object
  // identity with `results` at rest is safe. Resyncs whenever a *new*
  // extraction replaces `results` (reference change) — not on unrelated
  // parent re-renders, so in-progress edits survive those. Adjusted during
  // render (not in an effect) per https://react.dev/learn/you-might-not-need-an-effect.
  const [edited, setEdited] = useState<ExtractionData | null>(results);
  // Current page (1-indexed, §13 pagination). Reset to 1 alongside `edited`
  // on a *new* extraction (results reference change) — not on edits, which
  // never change row count or which page you're looking at.
  const [page, setPage] = useState(1);

  // Expand-to-modal (§13, "expand-to-modal" task) — the app's first overlay.
  // `edited`/`page` above are the only state the table depends on, and both
  // already live here in ResultsDisplay, so the modal doesn't need any
  // import/export of edit state on open/close: it's the same state the
  // inline card reads, just rendered through a second `<ResultsTable>`
  // instance (see the return below) while `expanded` is true. Declared
  // above the `prevResults` reset block below, which also closes the modal
  // on a new extraction — needs `setExpanded` in scope.
  const [expanded, setExpanded] = useState(false);

  const [prevResults, setPrevResults] = useState<ExtractionData | null>(results);
  if (results !== prevResults) {
    setPrevResults(results);
    setEdited(results);
    setPage(1);
    // A new extraction starting (or finishing) replaces `results` out from
    // under the modal — most visibly, starting one sets `results` to `null`
    // while `isLoading` flips true, which makes ResultsDisplay hit the
    // early `isLoading` return below and stop rendering the modal's JSX
    // entirely, orphaning `expanded=true` and, with it, the body-scroll
    // lock the modal-open effect set (its cleanup never runs because the
    // effect that owns it stops being reconciled once this component
    // renders that early-return branch instead — no JSX means no effects).
    // Closing here, at the same render-time reset that already resyncs
    // `edited`/`page` for the new extraction, is what makes the body-lock
    // effect (keyed on `expanded`) actually re-run and restore
    // `document.body.style.overflow` before that can happen. Deliberately
    // NOT routed through `closeModal()` below: that also refocuses the
    // expand button, which is meaningless (and, mid-loading, may not even
    // be mounted) when the modal is closing because the data underneath it
    // changed, not because the user asked to close it.
    setExpanded(false);
  }

  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Users who've asked the OS to minimize motion get an instant open/close
  // instead of the fade+scale — same convention as flashCell's scroll
  // behavior above, just applied to framer variants instead of a native DOM
  // API. Read once per render (cheap media-query check); the modal itself
  // only mounts while `expanded`, so this doesn't need to be reactive to a
  // mid-session OS setting change.
  const reduceMotion = prefersReducedMotion();

  const closeModal = useCallback(() => {
    setExpanded(false);
    // Restore focus to the button that opened the modal — without this,
    // focus would silently drop to <body> and keyboard users lose their
    // place.
    expandButtonRef.current?.focus();
  }, []);

  // Focus the close button whenever the modal opens, so keyboard/screen
  // reader users land inside the dialog rather than on whatever the
  // now-hidden expand button happens to be.
  useEffect(() => {
    if (expanded) {
      closeButtonRef.current?.focus();
    }
  }, [expanded]);

  // Escape closes the modal — listener added only while open, removed on
  // close/unmount, matching the resize-listener pattern elsewhere
  // (PDFPreview) rather than a permanently-mounted global handler.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, closeModal]);

  // Lock body scroll while the modal is open — this is a true overlay (not
  // an inline expand), so the page behind it shouldn't scroll along with it.
  // Restored on close (state flips back) AND on unmount (e.g. navigating
  // away with the modal still open), since both run this effect's cleanup.
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  const isArray = Array.isArray(results);
  const resultsArray: ExtractionResult[] = isArray ? results : results ? [results] : [];
  const editedArray: ExtractionResult[] = Array.isArray(edited) ? edited : edited ? [edited] : [];
  const rowCount = editedArray.length;
  // Rendering only ever slices `editedArray` for display — every lookup
  // keyed on a row (edits, originals, anchors, flash target, data-row
  // attributes) uses the ABSOLUTE index computed from this, never a
  // page-local one. See the correctness note on `onEditedRowsChange` and the
  // pagination task brief for why this matters.
  const currentPage = clampPage(page, rowCount, PAGE_SIZE);

  useImperativeHandle(
    ref,
    () => ({
      flashCell(fieldName: string, rowIndex: number) {
        const activate = () => {
          const container = tableContainerRef.current;
          let el: HTMLElement | null = null;
          try {
            el =
              container?.querySelector<HTMLElement>(
                `td[data-field="${CSS.escape(fieldName)}"][data-row="${rowIndex}"]`
              ) ?? null;
          } catch {
            el = null;
          }
          el?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
          flashTokenRef.current += 1;
          setFlashTarget({ field: fieldName, row: rowIndex, token: flashTokenRef.current });
          // Clear on a timer (rather than relying on onAnimationEnd) so the
          // overlay unmounts even under prefers-reduced-motion, where the CSS
          // animation is disabled and no animation-end event ever fires.
          setTimeout(() => setFlashTarget((prev) => (prev?.token === flashTokenRef.current ? null : prev)), 950);
        };
        // The target row may be on another page — if so, switch pages first
        // and let the table re-render before measuring/scrolling to the
        // cell, same idea as DocumentView's scrollToMark settling past its
        // own state-driven content swap (view switch) before activating.
        // This is a plain content swap (no width/layout transition to wait
        // out), so a couple of rAFs — enough for React to commit and paint
        // the new page's rows — is enough to settle on.
        const targetPage = clampPage(pageForRow(rowIndex, PAGE_SIZE), rowCount, PAGE_SIZE);
        if (targetPage !== currentPage) {
          setPage(targetPage);
          requestAnimationFrame(() => requestAnimationFrame(activate));
        } else {
          activate();
        }
      },
    }),
    [currentPage, rowCount]
  );

  // "Not found in source" hint (grounded extraction, T2): keyed off the
  // original extracted values/quotes, not the edited working copy — the
  // question this answers is "did the model's own extraction show up
  // verbatim in the document", which editing a cell doesn't change. Only
  // computed when an extracted-text view exists at all (same availability
  // rule `onJumpToValue`'s presence already encodes for the crosshair) —
  // `extractedText` is undefined for images, so this stays a no-op there.
  // Gated on `quotes` being present at all (not just non-empty): the
  // "unverified" hint is a grounded-mode concept (§T2.5 — ungrounded runs
  // never send `quotes`), so a plain value-based non-match (e.g. a
  // normalized date the model reformatted) must not read as "unverified"
  // for a request that never claimed source-grounding in the first place.
  const anchoredMap = useMemo(() => {
    if (!extractedText || !results || quotes === undefined) return null;
    const { anchors } = computeMatchRanges(extractedText, results, quotes);
    const map = new Map<string, boolean>();
    anchors.forEach((a) => map.set(`${a.row}:${a.field}`, a.anchored));
    return map;
  }, [extractedText, results, quotes]);

  // `rowIndex` here (and everywhere it's threaded through — EditableValue's
  // onCommit, resetField, data-row attributes, flash targeting) is always
  // the ABSOLUTE index into `edited`/`results`, never a page-local one:
  // pagination only slices at render time (see `pageRows` below), so an
  // edit made on page 3 lands on the right row whichever page is showing
  // when it's made or later viewed. `next` is computed from `edited` (this
  // render's snapshot, read directly rather than via a `setEdited` updater
  // function) so the plain `onEditedRowsChange` call below — which pushes
  // the full edited set up to the parent for save-to-dataset — can sit
  // alongside it as an ordinary side effect of this event handler, not
  // something happening inside a should-be-pure state updater.
  const updateField = (rowIndex: number, fieldName: string, value: FieldValue) => {
    if (!edited) return;
    const next: ExtractionData = Array.isArray(edited)
      ? edited.map((row, i) => (i === rowIndex ? { ...row, [fieldName]: value } : row))
      : { ...edited, [fieldName]: value };
    setEdited(next);
    onEditedRowsChange?.(Array.isArray(next) ? next : [next]);
  };

  const resetField = (rowIndex: number, fieldName: string) => {
    if (!edited || !results) return;
    const original = Array.isArray(results) ? results[rowIndex] : results;
    const resetValue = original?.[fieldName] ?? null;
    const next: ExtractionData = Array.isArray(edited)
      ? edited.map((row, i) => (i === rowIndex ? { ...row, [fieldName]: resetValue } : row))
      : { ...edited, [fieldName]: resetValue };
    setEdited(next);
    onEditedRowsChange?.(Array.isArray(next) ? next : [next]);
  };

  const handleCopy = () => {
    if (edited) {
      navigator.clipboard.writeText(JSON.stringify(edited, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!edited) return;
    downloadText("extracted-data.json", JSON.stringify(edited, null, 2), "application/json");
  };

  const handleDownloadCSV = () => {
    if (!edited || editedArray.length === 0) return;
    // Column order follows `fields`, not whatever key order the JSON
    // happened to produce; correct quoting (including "\n") comes from the
    // shared, unit-tested escaper (src/lib/export.ts) instead of a hand-rolled
    // one that only handled commas.
    const rows = editedArray.map((row) => Object.fromEntries(fields.map((f) => [f.name, row[f.name] ?? null])));
    downloadText("extracted-data.csv", toCsv(rows), "text/csv");
  };

  if (isLoading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card-elevated rounded-xl overflow-hidden">
        <div className="p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">Extracting data...</h3>
              <p className="text-xs text-[var(--text-tertiary)]">Analyzing document with AI</p>
            </div>
          </div>

          <div className="space-y-3">
            {fields.map((field, i) => (
              <div key={field.id} className="flex items-center gap-3">
                <div className="w-24 h-3 rounded animate-shimmer" style={{ animationDelay: `${i * 80}ms` }} />
                <div className="flex-1 h-3 rounded animate-shimmer" style={{ animationDelay: `${i * 80 + 40}ms` }} />
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-[var(--error)]/20 bg-[var(--error-subtle)] p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[var(--error)]/10 flex items-center justify-center">
            <AlertCircle className="w-4 h-4 text-[var(--error)]" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--error)]">Extraction failed</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{error}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!results || resultsArray.length === 0) {
    return null;
  }

  // Single and multi-row (extractMultiple) results render through the same
  // table: columns = fields, rows = records — single mode is just a one-row
  // table. The `#` index column only earns its keep once there's more than
  // one row to count.
  const showIndexColumn = rowCount > 1;
  // Page size 25, pager only when there's more than one page (§13). Slicing
  // happens here, at render, and nowhere else — every other consumer of row
  // data (exports, the View JSON pane, anchors/marks upstream in
  // DocumentView, onEditedRowsChange) works off the full `editedArray`/
  // `results`, never `pageRows`.
  const { startIndex, endIndex } = pageSlice(currentPage, rowCount, PAGE_SIZE);
  const pageRows = editedArray.slice(startIndex, endIndex);

  const handlePageChange = (next: number) => setPage(clampPage(next, rowCount, PAGE_SIZE));

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card-elevated rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--success-subtle)] flex items-center justify-center">
              <Check className="w-4 h-4 text-[var(--success)]" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">Complete</h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                {rowCount > 1
                  ? `${rowCount} rows extracted`
                  : `${fields.length} field${fields.length !== 1 ? "s" : ""} extracted`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ExportBar copied={copied} onCopy={handleCopy} onDownloadJson={handleDownload} onDownloadCsv={handleDownloadCSV} />
            <motion.button
              ref={expandButtonRef}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setExpanded(true)}
              aria-label="Expand table"
              title="Expand table"
              className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </div>

        <ResultsTable
          fields={fields}
          showIndexColumn={showIndexColumn}
          resultsArray={resultsArray}
          pageRows={pageRows}
          startIndex={startIndex}
          anchoredMap={anchoredMap}
          hoveredField={hoveredField}
          onHoverField={onHoverField}
          onJumpToValue={onJumpToValue}
          updateField={updateField}
          resetField={resetField}
          flashTarget={flashTarget}
          containerRef={tableContainerRef}
          scrollAreaClassName="max-h-[420px]"
        />

        {rowCount > PAGE_SIZE && (
          <PaginationBar page={currentPage} rowCount={rowCount} pageSize={PAGE_SIZE} onPageChange={handlePageChange} />
        )}

        <details className="border-t border-[var(--border-subtle)] group">
          <summary className="px-4 py-3 cursor-pointer text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors select-none">
            <span className="ml-1">View JSON</span>
          </summary>
          <div className="px-4 pb-4">
            <pre className="data p-3 rounded-lg bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)] overflow-x-auto border border-[var(--border-subtle)] max-h-64">
              {JSON.stringify(edited, null, 2)}
            </pre>
          </div>
        </details>
      </motion.div>

      {/* Expand-to-modal (§13) — the app's first overlay, so it deliberately
          stays quiet: an ink-tinted blurred scrim (not a flat black one) and
          a plain §13 card for the panel, no drop-shadow/border treatments
          beyond what card-elevated already gives every other surface. */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="fixed inset-0 z-50"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
            onClick={closeModal}
          >
            <div className="absolute inset-0 modal-backdrop backdrop-blur-sm" aria-hidden="true" />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="results-modal-title"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-4 md:inset-10 card-elevated rounded-2xl flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
                <div className="min-w-0">
                  <h2 id="results-modal-title" className="text-sm font-medium text-[var(--text-primary)]">
                    Results
                  </h2>
                  {providerModelLabel && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">{providerModelLabel}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <ExportBar
                    copied={copied}
                    onCopy={handleCopy}
                    onDownloadJson={handleDownload}
                    onDownloadCsv={handleDownloadCSV}
                  />
                  <button
                    ref={closeButtonRef}
                    onClick={closeModal}
                    aria-label="Close expanded results"
                    title="Close"
                    className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors ml-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Same table, same `edited`/`page` state as the inline card
                  above — a second `<ResultsTable>` instance, not a copy of
                  the data, so edits made here are already visible inline the
                  moment this modal closes (and vice versa). Jump-to-value
                  and hover linking are disabled here (undefined) since the
                  document pane they'd link to isn't visible behind this
                  overlay — see `ResultsTable`'s prop docs. */}
              <ResultsTable
                fields={fields}
                showIndexColumn={showIndexColumn}
                resultsArray={resultsArray}
                pageRows={pageRows}
                startIndex={startIndex}
                anchoredMap={anchoredMap}
                hoveredField={null}
                onHoverField={undefined}
                onJumpToValue={undefined}
                updateField={updateField}
                resetField={resetField}
                flashTarget={null}
                scrollAreaClassName="flex-1 min-h-0"
              />

              {rowCount > PAGE_SIZE && (
                <PaginationBar
                  page={currentPage}
                  rowCount={rowCount}
                  pageSize={PAGE_SIZE}
                  onPageChange={handlePageChange}
                  className="shrink-0"
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
