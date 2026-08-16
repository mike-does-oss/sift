import { mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { toCsv } from "@/lib/export";
import { isHosted } from "@/lib/profile";

/**
 * Expands a leading `~` (home dir) and requires the result to be an absolute
 * path — a bare relative folder (e.g. `"exports"`) would otherwise silently
 * resolve against whatever the server process's cwd happens to be, which is
 * never what a user means when they type a folder into a settings field.
 * Shared by the batches/schedules routes (request-time validation) and
 * `writeOutputs` (write-time, so a stored path is always re-validated).
 */
export function resolveOutputDir(dir: string): string {
  const trimmed = dir.trim();
  const expanded =
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;
  if (!path.isAbsolute(expanded)) {
    throw new Error(
      "Output folder must be an absolute path, e.g. ~/Documents/sift-exports or /Users/you/exports."
    );
  }
  return path.resolve(expanded);
}

// Same sanitizer the dataset CSV export route uses (src/app/api/datasets/[id]/csv/route.ts):
// strip path separators, quotes, and control characters so a batch/schedule
// name can't break out of the filename or smuggle a path component.
function sanitizeName(name: string): string {
  return name.replace(/[/\\"]/g, "_").replace(/[\x00-\x1f]/g, "").trim() || "output";
}

function timestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

/**
 * Reorders a row's keys to `_document` first, then `fields` in template
 * order, then anything else — so CSV columns come out deterministic
 * regardless of what order the model happened to emit JSON keys in, and
 * every configured field gets a column even if a particular row is missing
 * it (toCsv renders missing/undefined as an empty cell).
 */
function orderRow(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  if ("_document" in row) ordered._document = row._document;
  for (const f of fields) ordered[f] = row[f];
  for (const k of Object.keys(row)) {
    if (k === "_document" || fields.includes(k)) continue;
    ordered[k] = row[k];
  }
  return ordered;
}

export const OUTPUT_FORMATS = ["csv", "json", "both"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Validates a raw `outputDir` request field into either `{ value }` (`null`
 * when absent/empty — "no output folder configured") or `{ error }` (a
 * plain-English 400 message). Shared by the batches and schedules routes so
 * "absent/empty is fine, anything else must resolve to an absolute path" is
 * defined once.
 */
export function parseOutputDirInput(raw: unknown): { value: string | null } | { error: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { error: "outputDir must be a string." };
  if (raw.trim() === "") return { value: null };
  // Hosted (§SaaS-1 T6, decision 10): there is no server filesystem to write
  // to — a non-empty output folder is rejected outright (the hosted forms
  // hide the OUTPUT section, so only a hand-crafted request lands here).
  if (isHosted()) return { error: "Output folders aren't available on the hosted service." };
  try {
    return { value: resolveOutputDir(raw) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid output folder." };
  }
}

/** Validates a raw `outputFormat` request field against the enum, defaulting to `"csv"` when absent. */
export function parseOutputFormatInput(raw: unknown): { value: OutputFormat } | { error: string } {
  if (raw === undefined) return { value: "csv" };
  if (typeof raw === "string" && (OUTPUT_FORMATS as readonly string[]).includes(raw)) {
    return { value: raw as OutputFormat };
  }
  return { error: "outputFormat must be one of csv, json, both." };
}

/** Validates a raw `keepResults` request field, defaulting to `true` (keep) when absent. */
export function parseKeepResultsInput(raw: unknown): { value: boolean } | { error: string } {
  if (raw === undefined) return { value: true };
  if (typeof raw === "boolean") return { value: raw };
  return { error: "keepResults must be a boolean." };
}

export interface WriteOutputsInput {
  /** Batch or schedule name — becomes the filename stem. */
  name: string;
  rows: Record<string, unknown>[];
  /** Extraction field names, in template order — drives CSV column order. */
  fields: string[];
  dir: string;
  format: "csv" | "json" | "both";
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/** Writes the configured format(s) into `dir` (created if missing) and returns the written paths. */
export function writeOutputs({ name, rows, fields, dir, format, now = new Date() }: WriteOutputsInput): {
  written: string[];
} {
  const resolvedDir = resolveOutputDir(dir);
  mkdirSync(resolvedDir, { recursive: true });
  const base = `${sanitizeName(name)}-${timestamp(now)}`;
  const ordered = rows.map((r) => orderRow(r, fields));
  const written: string[] = [];

  if (format === "csv" || format === "both") {
    const csvPath = path.join(resolvedDir, `${base}.csv`);
    const csv = ordered.length > 0 ? toCsv(ordered) : ["_document", ...fields].join(",");
    writeFileSync(csvPath, csv);
    written.push(csvPath);
  }

  if (format === "json" || format === "both") {
    const jsonPath = path.join(resolvedDir, `${base}.json`);
    writeFileSync(jsonPath, JSON.stringify(ordered, null, 2));
    written.push(jsonPath);
  }

  return { written };
}
