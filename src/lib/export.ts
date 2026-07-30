export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

/**
 * Flattens a set of completed jobs into CSV-ready rows. Each job's `result`
 * may be a single object or (when the template extracts multiple rows) an
 * array of objects — the latter contributes one row per item. Every row gets
 * a `_document` column identifying the source file.
 */
export function jobsToRows(
  jobs: { result: unknown; filename?: string | null }[]
): Record<string, unknown>[] {
  return jobs.flatMap(({ result, filename }) => {
    if (result == null) return [];
    const items = Array.isArray(result) ? result : [result];
    return items.map((item) => ({
      _document: filename ?? "",
      ...(item as Record<string, unknown>),
    }));
  });
}

/** Triggers a client-side download of `content` as a file named `filename`. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
