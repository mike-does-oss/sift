/**
 * Pure helpers for the datasets feature (a local, durable results store —
 * users append extraction rows to named datasets whose headers match, then
 * export CSV). Route handlers under `src/app/api/datasets` use these to
 * validate and project incoming rows before persisting them.
 */

/** Same SET of keys, order-insensitive, case-sensitive. */
export function headersMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const key of setA) {
    if (!setB.has(key)) return false;
  }
  return true;
}

/**
 * Projects each row onto `headers`: missing keys become `null`, keys not in
 * `headers` are dropped. The returned objects' keys follow header order.
 */
export function rowsForHeaders(
  rows: Record<string, unknown>[],
  headers: string[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const header of headers) {
      projected[header] = header in row ? row[header] : null;
    }
    return projected;
  });
}
