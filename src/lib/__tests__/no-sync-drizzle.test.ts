import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * Guard: the hosted profile runs drizzle on the neon-http pg driver, which
 * has NO sync API — the better-sqlite3-only sync terminators (`.all()`,
 * `.get()`, `.run()`) and sync `db.transaction((tx) => …)` typecheck fine
 * (the shared type anchor is the sqlite database type) but crash at runtime
 * on pg. All app code must stick to the dialect-shared async surface.
 *
 * Allowed exceptions: `src/db/` internals, `src/lib/jobs.ts` (raw-sqlite job
 * store — split into per-dialect stores in T3), and tests.
 */

const SRC = path.resolve(__dirname, "../..");

const EXCLUDED_DIRS = new Set(["__tests__"]);
const EXCLUDED_PATHS = [path.join(SRC, "db") + path.sep, path.join(SRC, "lib", "jobs.ts")];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      if (EXCLUDED_PATHS.some((p) => full === p || full.startsWith(p))) continue;
      out.push(full);
    }
  }
  return out;
}

// Tight patterns to avoid false positives (e.g. `map.get(key)`, `fn.run(x)`):
// a zero-arg `.all()/.get()/.run()` terminating a builder chain — either
// directly after a `)` or as its own `.method()` continuation line — plus any
// `db.transaction(` / `tx.` sync-transaction usage.
const OFFENDERS: Array<{ name: string; re: RegExp }> = [
  { name: "sync terminator after chain", re: /\)\s*\.(all|get|run)\(\)/ },
  { name: "sync terminator on continuation line", re: /^\s*\.(all|get|run)\(\)/ },
  { name: "sync db.transaction", re: /\bdb\.transaction\(/ },
];

describe("no sync-only drizzle surface outside src/db and src/lib/jobs.ts", () => {
  it("finds no .all()/.get()/.run() terminators or db.transaction() calls", () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const { name, re } of OFFENDERS) {
          if (re.test(line)) {
            violations.push(`${path.relative(SRC, file)}:${i + 1} [${name}] ${line.trim()}`);
          }
        }
      });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
