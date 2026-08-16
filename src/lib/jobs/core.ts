import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { jobs, documents, schedules, templates, batches } from "@/db/schema";
import type { DbJob } from "@/db/schema";
import { runExtraction, type ExtractionOverride } from "@/lib/extraction";
import { readDocument } from "@/lib/storage";
import { parseDocument } from "@/lib/documents";
import { isScheduleDue } from "@/lib/schedule";
import { isHosted } from "@/lib/profile";
import { waitUntil } from "@vercel/functions";
import { jobsToRows } from "@/lib/export";
import { writeOutputs } from "@/lib/output-writer";
import type { ExtractionField, TemplateExample } from "@/types";

// Dialect-agnostic worker core (§SaaS-1 T3). Everything SQL-dialect-specific
// (claiming, counter increments, atomic inbox enqueue, sweeps) lives behind
// the `JobStore` seam: `store.local.ts` (raw better-sqlite3, the historical
// local behavior verbatim) and `store.pg.ts` (donor-pattern single-statement
// Postgres, multi-instance safe by construction).

export const MAX_ATTEMPTS = 3;
export const STALE_MS = 10 * 60 * 1000; // keep < any future long-running change

// §T3: examples are mode-independent — carried through regardless of source
// (single/batch/schedule) — unlike `grounded`, which jobs/batches never set.
export interface Snapshot { fields: ExtractionField[]; prompt: string; extractMultiple: boolean; examples?: TemplateExample[] }

export interface JobStore {
  dialect: "sqlite" | "pg";
  /** Atomically claim ONE runnable job (pending / retryable-failed / stale-processing), flipping it to `processing` and bumping `attempts`. */
  claimOne(): Promise<string | null>;
  /** Jobs still claimable after this pass (drives the cron self-chain on hosted). */
  countRemaining(): Promise<number>;
  incrementBatchCompleted(batchId: string): Promise<void>;
  incrementBatchFailed(batchId: string): Promise<void>;
  /**
   * Atomically claim a schedule's unprocessed inbox documents and insert
   * their jobs (stamped with `usedByoKey` — the owner's BYO decision frozen
   * at enqueue, §T5); returns the number of jobs created. `quotaLimit` caps
   * how many docs may be claimed this call (§T8 quota gate; null = no cap —
   * BYO owners and the local profile).
   */
  enqueueInbox(schedule: { id: string; userId: string }, snapshot: Snapshot, runId: string, usedByoKey: boolean, quotaLimit: number | null): Promise<number>;
  /** local-only: bracket an in-process run so the stale-reclaim arm can never re-claim a job this process is still running. */
  beginRun?(jobId: string): void;
  endRun?(jobId: string): void;
  /** pg-only: fail stale `processing` jobs that are out of attempts (orphans from a dead serverless instance). */
  sweepStale?(): Promise<void>;
  // Output flows are LOCAL-ONLY (hosted has no output folders — §T6 hides the
  // UI); the pg store must not implement these.
  runTerminalCounts?(runId: string): Promise<{ total: number; terminal: number }>;
  clearBatchResults?(batchId: string): Promise<void>;
  clearRunResults?(runId: string): Promise<void>;
}

// Lazily selected + cached per dialect: the stores are loaded via dynamic
// import so the local store's raw-sqlite module scope (getSqlite()) never
// loads on hosted, and vice versa.
const stores: { local?: JobStore; pg?: JobStore } = {};

export async function getJobStore(): Promise<JobStore> {
  if (isHosted()) return (stores.pg ??= (await import("./store.pg")).pgStore);
  return (stores.local ??= (await import("./store.local")).localStore);
}

/**
 * §SaaS-1 T5 — per-job BYO-key resolution. The worker processes ALL users'
 * jobs, so the decision is made from the JOB ROW (its `userId` / `usedByoKey`
 * frozen at enqueue), never from a session. Donor semantics (extracto
 * jobs.ts): a job runs on the owner's key iff the row was stamped
 * `usedByoKey` AND the owner still has a stored key. Unlike the donor, a key
 * deleted after enqueue does NOT fall back to platform credentials — the row
 * is quota-exempt (`usedByoKey` is what metering reads), so a fallback would
 * burn unmetered platform credits; this fn throws instead and the worker
 * records a terminal failure. Local
 * profile: always undefined — there is no key vault and no `users` table.
 */
export async function resolveJobApiKey(job: Pick<DbJob, "id" | "userId" | "usedByoKey">): Promise<string | undefined> {
  if (!isHosted() || !job.usedByoKey) return undefined;
  const { getDbUserById } = await import("@/lib/user");
  const owner = await getDbUserById(job.userId);
  if (!owner?.encryptedAnthropicKey) {
    throw new Error("BYO key was removed before this job ran");
  }
  const { decryptSecret } = await import("@/lib/crypto");
  return decryptSecret(owner.encryptedAnthropicKey);
}

async function runOne(store: JobStore, jobId: string): Promise<void> {
  store.beginRun?.(jobId);
  try {
    await runOneInner(store, jobId);
  } finally {
    store.endRun?.(jobId);
  }
}

async function runOneInner(store: JobStore, jobId: string): Promise<void> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return;
  try {
    if (!job.documentId) throw new Error("Job has no document");
    // The worker claims jobs across ALL users by design; per-job reads and
    // settings/provider resolution are scoped by the JOB ROW's userId (there
    // is no session here).
    const doc = await db.query.documents.findFirst({
      where: and(eq(documents.id, job.documentId), eq(documents.userId, job.userId)),
    });
    if (!doc) throw new Error("Document not found");
    // §T5 hosted model/key resolution: pin the job's frozen decision as a
    // trusted internal override (the `apiKey`-carrying form resolveProvider's
    // hosted branch honors verbatim). BYO → opus on the owner's decrypted
    // key; otherwise the owner's CURRENT plan model on the platform key
    // (donor semantics — plan changes retier queued jobs, the BYO stamp
    // doesn't unfreeze). Local profile: no override, behavior unchanged.
    const byoKey = await resolveJobApiKey(job);
    let override: ExtractionOverride | undefined;
    if (isHosted()) {
      const { PLANS, BYO_KEY_MODEL } = await import("@/lib/plans");
      if (byoKey !== undefined) {
        override = { provider: "anthropic", model: BYO_KEY_MODEL, apiKey: byoKey };
      } else {
        // Only non-BYO-stamped jobs reach here: a stamped job with a missing
        // key throws in resolveJobApiKey (quota-exempt row on the platform
        // key would be unmetered spend), which fails the job terminally.
        const { getDbUserById } = await import("@/lib/user");
        const owner = await getDbUserById(job.userId);
        if (!owner) throw new Error("Job owner not found");
        override = { provider: "anthropic", model: PLANS[owner.plan].model, apiKey: process.env.ANTHROPIC_API_KEY };
      }
    }
    const buf = await readDocument(doc.filePath);
    const source = await parseDocument(buf, doc.filename);
    const snap = job.templateSnapshot as Snapshot;
    const result = await runExtraction({
      source, filename: doc.filename,
      fields: snap.fields, prompt: snap.prompt, extractMultiple: snap.extractMultiple,
      examples: snap.examples,
    }, override, job.userId);
    if (!result.success) throw Object.assign(new Error(result.error), { provider: result.provider, model: result.model });
    await db.update(jobs).set({
      status: "completed", result: result.data, error: null, completedAt: new Date(),
      provider: result.provider, model: result.model,
    }).where(eq(jobs.id, jobId));
    if (job.batchId) await store.incrementBatchCompleted(job.batchId);
    await writeOutputsIfDone(store, job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const terminal = (job.attempts >= MAX_ATTEMPTS)
      || message.includes("declined to process")
      // Retrying can't bring a removed BYO key back — don't spin the attempts.
      || message.includes("BYO key was removed");
    try {
      await db.update(jobs).set({
        status: "failed", error: message, completedAt: terminal ? new Date() : null,
        provider: (err as { provider?: string }).provider ?? null, model: (err as { model?: string }).model ?? null,
      }).where(eq(jobs.id, jobId));
      if (terminal && job.batchId) await store.incrementBatchFailed(job.batchId);
      if (terminal) await writeOutputsIfDone(store, job);
    } catch (recordErr) {
      console.error("Failed to record job failure:", recordErr);
    }
  }
}

/** Extraction field names in template order, from a `Snapshot`'s `fields` — drives output column order. */
function fieldNames(snapshot: Snapshot): string[] {
  return (snapshot.fields ?? []).map((f) => f.name).filter((n): n is string => typeof n === "string" && n.length > 0);
}

/**
 * Called after a job reaches a terminal state (completed, or failed with no
 * retries left). If the job belongs to a batch whose every job is now
 * terminal, and/or a schedule run (`runId`) whose every job is now terminal,
 * writes that batch's/run's completed results to its configured output
 * folder and — if `keepResults` is off — nulls the `result` column for its
 * completed jobs (status/error columns are untouched either way).
 *
 * LOCAL-ONLY: output folders have no hosted analogue (no server filesystem
 * destination); hosted skips this entirely and §T6 hides the settings.
 *
 * Best-effort: any failure here is logged and swallowed. An output-write
 * problem must never fail, retry, or otherwise affect a job.
 */
async function writeOutputsIfDone(store: JobStore, job: { batchId: string | null; runId: string | null; scheduleId: string | null }): Promise<void> {
  if (isHosted()) return;
  if (job.batchId) {
    try {
      await maybeWriteBatchOutputs(store, job.batchId);
    } catch (err) {
      console.error("Failed to write batch outputs:", job.batchId, err);
    }
  }
  if (job.runId) {
    try {
      await maybeWriteRunOutputs(store, job.runId, job.scheduleId);
    } catch (err) {
      console.error("Failed to write schedule run outputs:", job.runId, err);
    }
  }
}

async function maybeWriteBatchOutputs(store: JobStore, batchId: string): Promise<void> {
  const batch = await db.query.batches.findFirst({ where: eq(batches.id, batchId) });
  if (!batch || !batch.outputDir) return;
  if (batch.completedCount + batch.failedCount < batch.totalCount) return; // not done yet

  const jobRows = await db
    .select({ job: jobs, filename: documents.filename })
    .from(jobs)
    .leftJoin(documents, eq(jobs.documentId, documents.id))
    .where(and(eq(jobs.batchId, batchId), eq(jobs.status, "completed")));

  const rows = jobsToRows(jobRows.map((r) => ({ result: r.job.result, filename: r.filename })));
  const fields = fieldNames(batch.templateSnapshot as Snapshot);
  writeOutputs({ name: batch.name, rows, fields, dir: batch.outputDir, format: batch.outputFormat });

  if (!batch.keepResults) {
    await store.clearBatchResults?.(batchId);
  }
}

async function maybeWriteRunOutputs(store: JobStore, runId: string, scheduleId: string | null): Promise<void> {
  if (!scheduleId) return;
  const schedule = await db.query.schedules.findFirst({ where: eq(schedules.id, scheduleId) });
  if (!schedule || !schedule.outputDir) return;

  const counts = await store.runTerminalCounts?.(runId);
  if (!counts || counts.total === 0 || counts.terminal < counts.total) return; // not done yet

  const jobRows = await db
    .select({ job: jobs, filename: documents.filename })
    .from(jobs)
    .leftJoin(documents, eq(jobs.documentId, documents.id))
    .where(and(eq(jobs.runId, runId), eq(jobs.status, "completed")));

  const rows = jobsToRows(jobRows.map((r) => ({ result: r.job.result, filename: r.filename })));
  const template = await db.query.templates.findFirst({
    where: and(eq(templates.id, schedule.templateId), eq(templates.userId, schedule.userId)),
  });
  const fields = template ? (template.fields as ExtractionField[]).map((f) => f.name) : [];
  writeOutputs({ name: schedule.name, rows, fields, dir: schedule.outputDir, format: schedule.outputFormat });

  if (!schedule.keepResults) {
    await store.clearRunResults?.(runId);
  }
}

export async function processPendingJobs(timeBudgetMs: number): Promise<{ processed: number; remaining: number }> {
  const store = await getJobStore();
  const start = Date.now();
  let processed = 0;
  if (store.sweepStale) {
    try {
      await store.sweepStale();
    } catch (err) {
      console.error("Stale job sweep failed:", err);
    }
  }
  while (Date.now() - start < timeBudgetMs) {
    try {
      const id = await store.claimOne();
      if (!id) break;
      await runOne(store, id);
      processed++;
    } catch (err) {
      console.error("Worker iteration failed:", err);
      break;
    }
  }
  return { processed, remaining: await store.countRemaining() };
}

async function enqueueInbox(scheduleId: string): Promise<number> {
  const schedule = await db.query.schedules.findFirst({ where: eq(schedules.id, scheduleId) });
  if (!schedule) return 0;
  // Scoped to the schedule owner's templates — a (buggy) cross-tenant
  // templateId reference must never leak another tenant's template into jobs.
  const template = await db.query.templates.findFirst({
    where: and(eq(templates.id, schedule.templateId), eq(templates.userId, schedule.userId)),
  });
  if (!template) return 0;
  const snapshot: Snapshot = {
    fields: template.fields as ExtractionField[],
    prompt: template.prompt,
    extractMultiple: template.extractMultiple,
    examples: (template.examples as TemplateExample[] | null) ?? undefined,
  };
  // §T5: freeze the owner's BYO decision onto the new job rows (a stored key
  // on a BYO-eligible plan ⇒ quota-exempt, opus). Local: always false.
  // §T8 final-review fix: schedule enqueue takes the quota gate too — these
  // jobs are metered, so without a cap an inbox could enqueue arbitrarily far
  // past the monthly quota on the platform key. Non-BYO owners get at most
  // `remainingQuota` jobs per enqueue; excess inbox docs simply stay
  // unprocessed (not failed) and are picked up after an upgrade/next month.
  let usedByoKey = false;
  let quotaLimit: number | null = null;
  if (isHosted()) {
    const { getDbUserById } = await import("@/lib/user");
    const { byoKeyActive } = await import("@/lib/gates");
    const owner = await getDbUserById(schedule.userId);
    if (!owner) return 0;
    usedByoKey = byoKeyActive(owner);
    if (!usedByoKey) {
      const { remainingQuota } = await import("@/lib/plans");
      const { getMonthlyUsage } = await import("@/lib/usage");
      quotaLimit = remainingQuota(owner.plan, await getMonthlyUsage(schedule.userId));
      if (quotaLimit <= 0) return 0;
    }
  }
  const runId = crypto.randomUUID();
  const store = await getJobStore();
  // Atomicity lives in the store: sqlite transaction locally, a single
  // claim-and-insert CTE statement on pg (neon-http has no interactive tx).
  return store.enqueueInbox(schedule, snapshot, runId, usedByoKey, quotaLimit);
}

/** Hosted-only: whether the schedule owner's plan still includes schedules. */
async function ownerHasSchedules(userId: string): Promise<boolean> {
  const { getDbUserById } = await import("@/lib/user");
  const { PLANS } = await import("@/lib/plans");
  const owner = await getDbUserById(userId);
  return Boolean(owner && PLANS[owner.plan].schedules);
}

export async function runDueSchedules(now = new Date()): Promise<{ schedulesChecked: number; jobsCreated: number }> {
  const active = await db.query.schedules.findMany({ where: eq(schedules.active, true) });
  let jobsCreated = 0;
  for (const s of active) {
    try {
      if (!isScheduleDue(s, now)) continue;
      // §T5 hosted downgrade-skip (donor semantics): a schedule whose owner's
      // plan no longer includes schedules is silently skipped — it stays
      // `active` and resumes on re-upgrade. `lastRunAt` is NOT advanced, so
      // the cron re-checks (cheaply) every tick. Local: no plans, no skip.
      if (isHosted() && !(await ownerHasSchedules(s.userId))) continue;
      jobsCreated += await enqueueInbox(s.id);
      await db.update(schedules).set({ lastRunAt: now }).where(eq(schedules.id, s.id));
    } catch (err) {
      console.error("Schedule run failed:", s.id, err);
    }
  }
  return { schedulesChecked: active.length, jobsCreated };
}

export async function enqueueScheduleNow(scheduleId: string): Promise<number> {
  const n = await enqueueInbox(scheduleId);
  await db.update(schedules).set({ lastRunAt: new Date() }).where(eq(schedules.id, scheduleId));
  return n;
}

/**
 * Kick the worker after a request handler enqueues jobs.
 *
 * Local: fire-and-forget in-process loop — the dev/desktop server is one
 * long-lived process, so the promise keeps running after the response.
 * Hosted: `void processPendingJobs(...)` would die with the serverless
 * invocation — instead POST the cron-authorized worker route, and hand the
 * fetch to `waitUntil` so the platform keeps it alive past the response.
 */
export function kickJobWorker(origin: string): void {
  if (!isHosted()) {
    void processPendingJobs(240_000);
    return;
  }
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : origin;
  const kicked = fetch(`${base}/api/jobs/process`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).then(() => undefined, () => undefined);
  try {
    waitUntil(kicked);
  } catch {
    // No request context (e.g. tests) — the fetch still runs, unanchored.
  }
}
