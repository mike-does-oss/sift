import { getSqlite } from "@/db";
import { MAX_ATTEMPTS, STALE_MS } from "./core";
import type { JobStore, Snapshot } from "./core";

// Local-profile job store: the historical raw better-sqlite3 implementation
// moved here verbatim (§SaaS-1 T3). Single long-lived process, sync driver —
// the in-process `inFlight` set and prepared-statement cache are safe and
// stay local-only. This module must never load on hosted (getSqlite throws).
const sqlite = getSqlite();

// Job ids currently inside runOne in this process. Excluded from the claim
// query so the stale-reclaim arm (meant for orphans from a past process)
// can never re-claim a job this same process is still actively running.
const inFlight = new Set<string>();

const claimStmtCache = new Map<string, import("better-sqlite3").Statement<unknown[]>>();

function buildClaimStmt(excludeCount: number): import("better-sqlite3").Statement<unknown[]> {
  const key = String(excludeCount);
  const cached = claimStmtCache.get(key);
  if (cached) return cached;
  const notIn = excludeCount > 0
    ? `AND id NOT IN (${Array.from({ length: excludeCount }, () => "?").join(", ")})`
    : "";
  const stmt = sqlite.prepare<unknown[]>(`
    UPDATE jobs SET status = 'processing', started_at = ?, attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE (
        status = 'pending'
        OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS} AND completed_at IS NULL)
        OR (status = 'processing' AND started_at < ? AND attempts < ${MAX_ATTEMPTS})
      )
      ${notIn}
      ORDER BY created_at LIMIT 1
    )
    RETURNING id
  `);
  claimStmtCache.set(key, stmt);
  return stmt;
}

function claimOne(): string | null {
  const now = Date.now();
  const excluded = Array.from(inFlight);
  const stmt = buildClaimStmt(excluded.length);
  const row = stmt.get(now, now - STALE_MS, ...excluded) as { id: string } | undefined;
  return row?.id ?? null;
}

export const localStore: JobStore = {
  dialect: "sqlite",

  async claimOne() {
    return claimOne();
  },

  beginRun(jobId: string) {
    inFlight.add(jobId);
  },

  endRun(jobId: string) {
    inFlight.delete(jobId);
  },

  async incrementBatchCompleted(batchId: string) {
    sqlite.prepare(`UPDATE batches SET completed_count = completed_count + 1 WHERE id = ?`).run(batchId);
  },

  async incrementBatchFailed(batchId: string) {
    sqlite.prepare(`UPDATE batches SET failed_count = failed_count + 1 WHERE id = ?`).run(batchId);
  },

  async countRemaining() {
    const remain = sqlite.prepare(`
      SELECT count(*) AS n FROM jobs
      WHERE status = 'pending' OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS} AND completed_at IS NULL)
    `).get() as { n: number };
    return remain.n;
  },

  async runTerminalCounts(runId: string) {
    return sqlite.prepare(`
      SELECT
        count(*) AS total,
        sum(CASE WHEN status = 'completed' OR (status = 'failed' AND completed_at IS NOT NULL) THEN 1 ELSE 0 END) AS terminal
      FROM jobs WHERE run_id = ?
    `).get(runId) as { total: number; terminal: number };
  },

  async clearBatchResults(batchId: string) {
    sqlite.prepare(`UPDATE jobs SET result = NULL WHERE batch_id = ? AND status = 'completed'`).run(batchId);
  },

  async clearRunResults(runId: string) {
    sqlite.prepare(`UPDATE jobs SET result = NULL WHERE run_id = ? AND status = 'completed'`).run(runId);
  },

  async enqueueInbox(schedule: { id: string; userId: string }, snapshot: Snapshot, runId: string) {
    // Atomic claim: transaction over sync driver
    const tx = sqlite.transaction(() => {
      // Inbox documents inherit the schedule's tenant: filter and stamp the
      // new job rows with the schedule row's user_id.
      const inbox = sqlite.prepare(
        `SELECT id FROM documents WHERE schedule_id = ? AND user_id = ? AND processed_at IS NULL`
      ).all(schedule.id, schedule.userId) as Array<{ id: string }>;
      const insert = sqlite.prepare(`
        INSERT INTO jobs (id, user_id, document_id, template_snapshot, source, schedule_id, run_id, status, attempts, created_at)
        VALUES (?, ?, ?, ?, 'schedule', ?, ?, 'pending', 0, ?)
      `);
      const mark = sqlite.prepare(`UPDATE documents SET processed_at = ? WHERE id = ?`);
      const now = Date.now();
      for (const d of inbox) {
        insert.run(crypto.randomUUID(), schedule.userId, d.id, JSON.stringify(snapshot), schedule.id, runId, now);
        mark.run(now, d.id);
      }
      return inbox.length;
    });
    return tx();
  },
};
