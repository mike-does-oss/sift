/**
 * Pure display helpers for job rows (Runs → History, the Overview activity
 * list, and the batch/schedule detail headers). Jobs are named by precedence:
 * the joined `documents.filename` (batch/schedule jobs), then the job's own
 * `sourceFilename` (single runs — the extract route parses the upload
 * in-request and never writes a documents row), then a summary derived from
 * the job's `templateSnapshot` ("3 fields · grounded"). Never a bare "—".
 */

export const HISTORY_FILTERS = ["all", "failed", "single", "batch", "schedule"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export const HISTORY_FILTER_LABELS: Record<HistoryFilter, string> = {
  all: "All",
  failed: "Failed",
  single: "Single",
  batch: "Batch",
  schedule: "Schedule",
};

interface FilterableJob {
  status: string;
  source: string;
}

/** Client-side filter over already-fetched history rows: "failed" filters by status, the source filters by `job.source`, "all" passes everything. */
export function filterJobs<T extends { job: FilterableJob }>(rows: T[], filter: HistoryFilter): T[] {
  if (filter === "all") return rows;
  if (filter === "failed") return rows.filter((r) => r.job.status === "failed");
  return rows.filter((r) => r.job.source === filter);
}

/** Defensive read of `templateSnapshot.fields[].name` — the snapshot is untyped JSON from the DB. */
export function snapshotFieldNames(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null || !("fields" in snapshot)) return [];
  const fields = (snapshot as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .map((f) => (typeof f === "object" && f !== null && "name" in f ? (f as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === "string" && name.trim() !== "");
}

/** The template name a snapshot was taken from, when the snapshot carries one (newer batch snapshots do); null otherwise. */
export function snapshotTemplateName(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null || !("name" in snapshot)) return null;
  const name = (snapshot as { name?: unknown }).name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

/** '3 fields · grounded' / '1 field' — the last-resort identity for a job with no filename anywhere. "Extraction" when even the snapshot is unreadable. */
export function snapshotSummary(snapshot: unknown): string {
  const count = snapshotFieldNames(snapshot).length;
  if (count === 0) return "Extraction";
  const base = count === 1 ? "1 field" : `${count} fields`;
  const grounded =
    typeof snapshot === "object" && snapshot !== null && (snapshot as { grounded?: unknown }).grounded === true;
  return grounded ? `${base} · grounded` : base;
}

/** Display identity for a job row: joined document filename → the job's own `sourceFilename` → template-derived summary. Never a bare "—". */
export function jobIdentity(
  filename: string | null | undefined,
  sourceFilename: string | null | undefined,
  templateSnapshot: unknown
): string {
  if (filename) return filename;
  if (sourceFilename) return sourceFilename;
  return snapshotSummary(templateSnapshot);
}

/** How a result value renders in the history mini-table: strings verbatim, null/undefined as "—", everything else as compact JSON. */
export function formatResultValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export interface SnapshotResultView {
  fieldNames: string[];
  /** Result rows as plain objects (a single-object result becomes one row). */
  rows: Record<string, unknown>[];
  /** Values outside the snapshot's fields, per row — null when the snapshot covers everything (the common case). Rendered as the raw-JSON fallback. */
  extras: Record<string, unknown>[] | null;
}

/**
 * Projects a job's `result` onto its `templateSnapshot`'s field names for the
 * expanded-row mini table. Returns null when there's nothing table-shaped to
 * show (no snapshot fields, or result rows that aren't objects) — the caller
 * falls back to the raw JSON pre.
 */
export function snapshotResultView(templateSnapshot: unknown, result: unknown): SnapshotResultView | null {
  const fieldNames = snapshotFieldNames(templateSnapshot);
  if (fieldNames.length === 0 || result === null || result === undefined) return null;
  const rawRows = Array.isArray(result) ? result : [result];
  if (rawRows.length === 0) return null;
  if (!rawRows.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) return null;
  const rows = rawRows as Record<string, unknown>[];

  const known = new Set(fieldNames);
  const extraRows = rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !known.has(key)))
  );
  const hasExtras = extraRows.some((row) => Object.keys(row).length > 0);
  return { fieldNames, rows, extras: hasExtras ? extraRows : null };
}
