"use client";

import { motion } from "framer-motion";
import { Check, Copy, Download, AlertCircle, Loader2, RotateCcw, Crosshair } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExtractionField, ExtractionData, ExtractionResult } from "@/types";
import { toCsv, downloadText } from "@/lib/export";
import { computeMatchRanges, type Quotes } from "@/lib/highlight";
import { SaveToDatasetPanel } from "./SaveToDatasetPanel";

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

  // Booleans are constrained to true/false — no free text, so no invalid state is reachable.
  if (isBooleanVal) {
    return (
      <select
        value={value ? "true" : "false"}
        onChange={(e) => onCommit(e.target.value === "true")}
        className="data w-full px-2 py-1.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-muted)] focus:outline-none transition-colors"
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
          className={`data w-full px-2 py-1.5 rounded-md bg-[var(--surface-inset)] border text-sm text-[var(--text-primary)] focus:border-[var(--accent-muted)] focus:outline-none transition-colors resize-y ${
            invalid ? "border-[var(--error)]" : "border-[var(--border-subtle)]"
          }`}
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
        className={`data w-full px-2 py-1.5 rounded-md bg-[var(--surface-inset)] border text-sm text-[var(--text-primary)] focus:border-[var(--accent-muted)] focus:outline-none transition-colors ${
          invalid ? "border-[var(--error)]" : "border-[var(--border-subtle)]"
        }`}
      />
      {invalid && <p className="text-[10px] text-[var(--error)] mt-0.5">Invalid number — not saved yet</p>}
    </div>
  );
}

/** Copy JSON / download CSV / download JSON — always export the EDITED values (see `edited` in ResultsDisplay). */
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

export function ResultsDisplay({
  results,
  fields,
  isLoading,
  error,
  onJumpToValue,
  extractedText,
  quotes,
}: ResultsDisplayProps) {
  const [copied, setCopied] = useState(false);
  // Working copy the user edits. Immutable updates only, so sharing object
  // identity with `results` at rest is safe. Resyncs whenever a *new*
  // extraction replaces `results` (reference change) — not on unrelated
  // parent re-renders, so in-progress edits survive those. Adjusted during
  // render (not in an effect) per https://react.dev/learn/you-might-not-need-an-effect.
  const [edited, setEdited] = useState<ExtractionData | null>(results);
  const [prevResults, setPrevResults] = useState<ExtractionData | null>(results);
  if (results !== prevResults) {
    setPrevResults(results);
    setEdited(results);
  }

  const isArray = Array.isArray(results);
  const resultsArray: ExtractionResult[] = isArray ? results : results ? [results] : [];
  const editedArray: ExtractionResult[] = Array.isArray(edited) ? edited : edited ? [edited] : [];

  // "Not found in source" hint (grounded extraction, T2): keyed off the
  // original extracted values/quotes, not the edited working copy — the
  // question this answers is "did the model's own extraction show up
  // verbatim in the document", which editing a cell doesn't change. Only
  // computed when an extracted-text view exists at all (same availability
  // rule `onJumpToValue`'s presence already encodes for the crosshair) —
  // `extractedText` is undefined for images, so this stays a no-op there.
  const anchoredMap = useMemo(() => {
    if (!extractedText || !results) return null;
    const { anchors } = computeMatchRanges(extractedText, results, quotes);
    const map = new Map<string, boolean>();
    anchors.forEach((a) => map.set(`${a.row}:${a.field}`, a.anchored));
    return map;
  }, [extractedText, results, quotes]);

  const updateField = (rowIndex: number, fieldName: string, value: FieldValue) => {
    setEdited((prev) => {
      if (!prev) return prev;
      if (Array.isArray(prev)) {
        const next = prev.slice();
        next[rowIndex] = { ...next[rowIndex], [fieldName]: value };
        return next;
      }
      return { ...prev, [fieldName]: value };
    });
  };

  const resetField = (rowIndex: number, fieldName: string) => {
    setEdited((prev) => {
      if (!prev || !results) return prev;
      const original = Array.isArray(results) ? results[rowIndex] : results;
      if (Array.isArray(prev)) {
        const next = prev.slice();
        next[rowIndex] = { ...next[rowIndex], [fieldName]: original?.[fieldName] ?? null };
        return next;
      }
      return { ...prev, [fieldName]: original?.[fieldName] ?? null };
    });
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
  const rowCount = editedArray.length;
  const showIndexColumn = rowCount > 1;
  const fieldKeys = fields.map((f) => f.name);

  return (
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
        <ExportBar copied={copied} onCopy={handleCopy} onDownloadJson={handleDownload} onDownloadCsv={handleDownloadCSV} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-inset)]">
              {showIndexColumn && (
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-tertiary)] w-10">#</th>
              )}
              {fields.map((field) => (
                <th key={field.id} className="px-3 py-2 text-left text-xs font-medium text-[var(--text-tertiary)]">
                  <span className="data block">{field.name}</span>
                  <span className="block text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]/70 mt-0.5">
                    {field.type}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editedArray.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface-overlay)]/30 transition-colors align-top"
              >
                {showIndexColumn && (
                  <td className="px-4 py-2.5 text-[var(--text-tertiary)] tabular-nums">{rowIndex + 1}</td>
                )}
                {fields.map((field) => {
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
                  return (
                    <td
                      key={field.id}
                      className="px-2 py-2 min-w-[9rem]"
                      title={unanchored ? "Value not found verbatim in the document — verify manually" : undefined}
                    >
                      <div className="group/cell flex items-start gap-1">
                        <div
                          className={`flex-1 min-w-0 ${
                            unanchored ? "border-b border-dashed border-[var(--text-tertiary)]" : ""
                          }`}
                        >
                          <EditableValue value={current} onCommit={(v) => updateField(rowIndex, field.name, v)} />
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-center gap-0.5 opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100 transition-opacity">
                          {onJumpToValue && (
                            <button
                              onClick={() => onJumpToValue(field.name, rowIndex)}
                              aria-label={`Jump to ${field.name} in document`}
                              title="Jump to highlight in document"
                              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
                            >
                              <Crosshair className="w-3 h-3" />
                            </button>
                          )}
                          {isEdited && (
                            <button
                              onClick={() => resetField(rowIndex, field.name)}
                              aria-label={`Reset ${field.name} to extracted value`}
                              title="Reset to extracted value"
                              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      {isEdited && (
                        <span className="mt-0.5 inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--accent-tint)] text-[var(--accent)]">
                          edited
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
        <SaveToDatasetPanel fieldKeys={fieldKeys} rows={editedArray} />
      </div>

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
  );
}
