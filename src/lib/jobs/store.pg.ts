import { sql, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { db } from "@/db";
import { MAX_ATTEMPTS } from "./core";
import type { JobStore, Snapshot } from "./core";

// Hosted-profile job store (§SaaS-1 T3, donor: extracto-app). neon-http has
// no interactive transactions and the worker may run on several serverless
// instances at once, so every operation here is a SINGLE statement: the claim
// uses `FOR UPDATE SKIP LOCKED`, counters are one-shot relative increments,
// and the inbox enqueue is one claim-and-insert CTE. No in-process state
// (no inFlight set, no statement cache) — multi-instance safe by construction.
//
// The shared `db` is typed against the sqlite anchor; raw execution needs the
// pg surface, which only exists at runtime on hosted.
const pgDb = () => db as unknown as NeonHttpDatabase<Record<string, never>>;

/**
 * The single-statement claim. The three claimable arms mirror the local
 * store exactly: pending, retryable-failed (attempts left, not terminal),
 * and stale-processing (an orphan from a dead instance, attempts left).
 * Exported for SQL-shape tests.
 */
export function claimSql(): SQL {
  return sql`
    UPDATE jobs SET status = 'processing', started_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'pending'
        OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS} AND completed_at IS NULL)
        OR (status = 'processing' AND started_at < now() - interval '10 minutes' AND attempts < ${MAX_ATTEMPTS})
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;
}

/**
 * Atomically claim a schedule's unprocessed inbox docs and create their jobs
 * in ONE statement, so a mid-flight failure can't produce duplicate jobs.
 * Raw SQL bypasses drizzle's app-level `$defaultFn` defaults — hence the
 * explicit `gen_random_uuid()::text` id and `now()` created_at. The snapshot
 * is passed as an object with a `::jsonb` cast (the driver serializes it);
 * status/attempts are written explicitly, and `used_byo_key` freezes the
 * owner's BYO decision onto every row of the run (§T5 — computed once by
 * core.enqueueInbox from the owner's user row). Exported for SQL-shape tests.
 */
export function enqueueInboxSql(schedule: { id: string; userId: string }, snapshot: Snapshot, runId: string, usedByoKey: boolean, quotaLimit: number | null): SQL {
  // §T8 quota gate: the claim runs through an id-subquery so it can carry a
  // LIMIT (Postgres UPDATE has no LIMIT of its own). The outer WHERE re-checks
  // `processed_at IS NULL` so a concurrent enqueue that raced the subquery
  // claims nothing twice. Oldest docs first, so a capped run drains the inbox
  // in upload order.
  const cap = quotaLimit === null ? sql`` : sql` LIMIT ${quotaLimit}`;
  return sql`
    WITH claimed AS (
      UPDATE documents SET processed_at = now()
      WHERE processed_at IS NULL AND id IN (
        SELECT id FROM documents
        WHERE schedule_id = ${schedule.id} AND processed_at IS NULL AND user_id = ${schedule.userId}
        ORDER BY created_at${cap}
      )
      RETURNING id
    )
    INSERT INTO jobs (id, user_id, document_id, template_snapshot, source, schedule_id, run_id, status, attempts, created_at, used_byo_key)
    SELECT gen_random_uuid()::text, ${schedule.userId}, claimed.id, ${snapshot}::jsonb, 'schedule', ${schedule.id}, ${runId}, 'pending', 0, now(), ${usedByoKey}
    FROM claimed
    RETURNING id
  `;
}

export const pgStore: JobStore = {
  dialect: "pg",

  async claimOne() {
    const res = await pgDb().execute(claimSql());
    const row = res.rows[0] as { id: string } | undefined;
    return row?.id ?? null;
  },

  async incrementBatchCompleted(batchId: string) {
    await pgDb().execute(sql`UPDATE batches SET completed_count = completed_count + 1 WHERE id = ${batchId}`);
  },

  async incrementBatchFailed(batchId: string) {
    await pgDb().execute(sql`UPDATE batches SET failed_count = failed_count + 1 WHERE id = ${batchId}`);
  },

  async countRemaining() {
    try {
      const res = await pgDb().execute(sql`
        SELECT count(*)::int AS n FROM jobs
        WHERE status = 'pending'
          OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS} AND completed_at IS NULL)
          OR (status = 'processing' AND started_at < now() - interval '10 minutes' AND attempts < ${MAX_ATTEMPTS})
      `);
      return (res.rows[0] as { n: number }).n;
    } catch (err) {
      console.error("Remaining-count query failed:", err);
      return 0;
    }
  },

  // Jobs stuck in `processing` past staleness with no attempts left can never
  // be re-claimed (the claim's stale arm requires attempts < MAX) — sweep
  // them to terminal `failed` and roll their batches' failed_count forward.
  async sweepStale() {
    const swept = (await pgDb().execute(sql`
      UPDATE jobs SET status = 'failed', error = 'Worker timed out', completed_at = now()
      WHERE status = 'processing' AND started_at < now() - interval '10 minutes' AND attempts >= ${MAX_ATTEMPTS}
      RETURNING batch_id
    `)).rows as unknown as Array<{ batch_id: string | null }>;
    for (const { batch_id } of swept) {
      if (batch_id) {
        await pgDb().execute(sql`UPDATE batches SET failed_count = failed_count + 1 WHERE id = ${batch_id}`);
      }
    }
  },

  async enqueueInbox(schedule: { id: string; userId: string }, snapshot: Snapshot, runId: string, usedByoKey: boolean, quotaLimit: number | null) {
    const res = await pgDb().execute(enqueueInboxSql(schedule, snapshot, runId, usedByoKey, quotaLimit));
    return res.rows.length;
  },
};
