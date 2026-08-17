import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { jobs, documents, schedules, templates, batches, datasets, datasetRows } from "@/db/schema";
import type { DbJob, DbSchedule } from "@/db/schema";
import { runExtraction, type ExtractionOverride } from "@/lib/extraction";
import { readDocument } from "@/lib/storage";
import { parseDocument } from "@/lib/documents";
import { isScheduleDue } from "@/lib/schedule";
import { isHosted } from "@/lib/profile";
import { waitUntil } from "@vercel/functions";
import { jobsToRows, toCsv } from "@/lib/export";
import { headersMatch, rowsForHeaders } from "@/lib/datasets";
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
  /**
   * pg-only: fail stale `processing` jobs that are out of attempts (orphans
   * from a dead serverless instance). Returns each swept row's batch/run
   * identity — a sweep IS a terminal transition, so the caller must fire the
   * run-delivery hook for every distinct swept runId (the `run_deliveries`
   * insert-claim keeps double-fires safe). Batch failed_count rollups stay
   * inside the store.
   */
  sweepStale?(): Promise<Array<{ batchId: string | null; runId: string | null; scheduleId: string | null }>>;
  /**
   * Terminal/total counts for a schedule run — drives BOTH all-terminal
   * hooks: local output-folder writes and hosted run delivery (§INBOX T2).
   */
  runTerminalCounts?(runId: string): Promise<{ total: number; terminal: number }>;
  /**
   * §INBOX T2: atomically claim a run's single delivery slot — an
   * insert-on-conflict-do-nothing into `run_deliveries`. Returns true iff
   * THIS caller inserted the row (and therefore must deliver); every
   * concurrent/later caller gets false. This is what makes the delivery
   * hook idempotent when several jobs of one run reach terminal at once.
   */
  claimRunDelivery?(runId: string): Promise<boolean>;
  // Output flows are LOCAL-ONLY (hosted has no output folders — §T6 hides the
  // UI); the pg store must not implement these.
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
  if (isHosted()) {
    // §INBOX T2: hosted has no output folders — schedule runs get the
    // delivery hook instead (dataset auto-append + digest email). Batches
    // are deliberately NOT extended (no runId → no-op): digests/datasets are
    // schedule-run features per the plan; batches keep their existing UX.
    await deliverRunResultsIfDone(store, job);
    return;
  }
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

const MAX_DIGEST_FAILURES = 5;
const MAX_DIGEST_CSV_BYTES = 1024 * 1024; // attach the CSV only when it fits in 1MB

/**
 * §INBOX T2 — the hosted counterpart of the local output-folder writes: when
 * a schedule run (`runId`) reaches all-terminal, deliver its results ONCE —
 * append completed rows to the schedule's dataset (if configured) and email
 * the owner a digest (if enabled). The hook fires from every terminal
 * transition of the run's jobs; the `run_deliveries` insert-claim
 * (`store.claimRunDelivery`) makes exactly one of them the deliverer.
 *
 * Donor writeOutputs convention: everything here is best-effort. The two
 * legs are try/caught independently, the whole hook is try/caught, and a
 * delivery problem must never fail, retry, or otherwise affect a job.
 * Exported for unit tests.
 */
export async function deliverRunResultsIfDone(store: JobStore, job: { runId: string | null; scheduleId: string | null }): Promise<void> {
  if (!isHosted() || !job.runId || !job.scheduleId) return;
  try {
    const counts = await store.runTerminalCounts?.(job.runId);
    if (!counts || counts.total === 0 || counts.terminal < counts.total) return; // not done yet
    if (!(await store.claimRunDelivery?.(job.runId))) return; // another transition won — it delivers
    const schedule = await db.query.schedules.findFirst({ where: eq(schedules.id, job.scheduleId) });
    if (!schedule) return;

    const jobRows = await db
      .select({ job: jobs, filename: documents.filename })
      .from(jobs)
      .leftJoin(documents, eq(jobs.documentId, documents.id))
      .where(eq(jobs.runId, job.runId));
    const completed = jobRows.filter((r) => r.job.status === "completed");
    const failures = jobRows
      .filter((r) => r.job.status === "failed")
      .map((r) => ({ filename: r.filename ?? "unknown document", error: r.job.error ?? "Unknown error" }));
    const rows = jobsToRows(completed.map((r) => ({ result: r.job.result, filename: r.filename })));
    const snapshot = jobRows[0]?.job.templateSnapshot as Snapshot | undefined;

    try {
      await appendRunRowsToDataset(schedule, snapshot, rows);
    } catch (err) {
      console.error("Failed to append run results to dataset:", job.runId, err);
    }
    try {
      await sendRunDigest(schedule, { total: counts.total, completedCount: completed.length, failures, rows });
    } catch (err) {
      console.error("Failed to send run digest:", job.runId, err);
    }
  } catch (err) {
    console.error("Run delivery failed:", job.runId, err);
  }
}

/**
 * Dataset auto-append leg. Follows the existing save-to-dataset shape
 * exactly (batch page → SaveToDatasetPanel → rows route): the match is
 * `headersMatch` between the dataset's headers and the run snapshot's field
 * keys (so `_document` and other extra `jobsToRows` columns are not part of
 * the contract), and `rowsForHeaders` projects each row onto the dataset's
 * headers before insert. Missing/foreign dataset or a header mismatch is one
 * console.log and a clean skip — never a failed run.
 */
async function appendRunRowsToDataset(schedule: DbSchedule, snapshot: Snapshot | undefined, rows: Record<string, unknown>[]): Promise<void> {
  if (!schedule.datasetId || rows.length === 0) return;
  // Ownership re-check: the dataset must still exist AND belong to the
  // schedule's owner (it may have been deleted since the schedule was saved,
  // and a cross-tenant id must never receive rows).
  const dataset = await db.query.datasets.findFirst({
    where: and(eq(datasets.id, schedule.datasetId), eq(datasets.userId, schedule.userId)),
  });
  if (!dataset) {
    console.log(`[run-delivery] dataset ${schedule.datasetId} missing or not owned by schedule ${schedule.id}'s owner — skipping append`);
    return;
  }
  const headers = dataset.headers as string[];
  const fields = snapshot ? fieldNames(snapshot) : [];
  if (!headersMatch(headers, fields)) {
    console.log(`[run-delivery] dataset ${dataset.id} headers no longer match schedule ${schedule.id}'s template fields — skipping append`);
    return;
  }
  const projected = rowsForHeaders(rows, headers);
  // Single statement — needs no transaction (matches the rows route). No
  // sourceJobId: rows come from many jobs (the panel's multi-job convention).
  await db
    .insert(datasetRows)
    .values(projected.map((row) => ({ userId: schedule.userId, datasetId: dataset.id, row, sourceJobId: null })));
}

interface RunDigest {
  total: number;
  completedCount: number;
  failures: Array<{ filename: string; error: string }>;
  rows: Record<string, unknown>[];
}

/**
 * Digest email leg: one email to the owner's `users.email` via the Resend
 * lib. Missing RESEND envs or a missing owner email → log + skip (never an
 * error). The completed rows ride along as a CSV attachment when they fit
 * under `MAX_DIGEST_CSV_BYTES`.
 */
async function sendRunDigest(schedule: DbSchedule, run: RunDigest): Promise<void> {
  if (!schedule.notifyEmail) return;
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_INBOUND_DOMAIN) {
    console.log(`[run-delivery] RESEND_API_KEY / RESEND_INBOUND_DOMAIN not set — skipping digest for schedule ${schedule.id}`);
    return;
  }
  const { getDbUserById } = await import("@/lib/user");
  const owner = await getDbUserById(schedule.userId);
  if (!owner?.email) {
    console.log(`[run-delivery] schedule ${schedule.id}'s owner has no email — skipping digest`);
    return;
  }

  let attachments: Array<{ filename: string; content: string }> | undefined;
  if (run.rows.length > 0) {
    const csv = toCsv(run.rows);
    if (Buffer.byteLength(csv, "utf8") <= MAX_DIGEST_CSV_BYTES) {
      // Same filename sanitization as the dataset CSV route.
      const safeName = schedule.name.replace(/[/\\"]/g, "_").replace(/[\x00-\x1f]/g, "").trim() || "results";
      attachments = [{ filename: `${safeName}.csv`, content: Buffer.from(csv, "utf8").toString("base64") }];
    }
  }

  const { sendEmail } = await import("@/lib/resend");
  await sendEmail({
    to: owner.email,
    subject: `Sift: ${schedule.name} processed ${run.total} document${run.total === 1 ? "" : "s"}`,
    html: digestHtml(schedule, run),
    attachments,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** First line of an error, clipped — digests list one-liners, not stack traces. */
function errorOneLiner(error: string): string {
  const line = error.split("\n")[0].trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/** `https://<APP_URL or VERCEL_URL>` (protocol added if the env omits it), or null when neither is set. */
function appBaseUrl(): string | null {
  const host = process.env.APP_URL || process.env.VERCEL_URL;
  if (!host) return null;
  return (host.startsWith("http") ? host : `https://${host}`).replace(/\/+$/, "");
}

// Plain HTML in the playbook §4 interface voice: active, plain, consistent —
// what happened, what broke, where to look.
function digestHtml(schedule: DbSchedule, run: RunDigest): string {
  const parts: string[] = [
    `<p>Sift processed ${run.total} document${run.total === 1 ? "" : "s"} for <strong>${escapeHtml(schedule.name)}</strong>.</p>`,
    `<p>${run.completedCount} completed &middot; ${run.failures.length} failed</p>`,
  ];
  if (run.failures.length > 0) {
    const items = run.failures
      .slice(0, MAX_DIGEST_FAILURES)
      .map((f) => `<li>${escapeHtml(f.filename)} — ${escapeHtml(errorOneLiner(f.error))}</li>`);
    if (run.failures.length > MAX_DIGEST_FAILURES) {
      items.push(`<li>and ${run.failures.length - MAX_DIGEST_FAILURES} more</li>`);
    }
    parts.push(`<ul>${items.join("")}</ul>`);
  }
  const base = appBaseUrl();
  if (base) {
    parts.push(`<p><a href="${base}/dashboard/schedules/${schedule.id}">View the run in Sift</a></p>`);
  }
  return parts.join("\n");
}

export async function processPendingJobs(timeBudgetMs: number): Promise<{ processed: number; remaining: number }> {
  const store = await getJobStore();
  const start = Date.now();
  let processed = 0;
  if (store.sweepStale) {
    try {
      const swept = await store.sweepStale();
      // Review-round fix: sweeping is a terminal transition, so runs whose
      // LAST live job just got swept would otherwise never deliver (no job of
      // the run transitions again — digest + dataset append permanently
      // lost). Fire the delivery hook once per distinct swept run; the
      // insert-claim inside makes a double-fire (e.g. vs a racing worker)
      // harmless, and the hook itself never throws.
      const deliveredRuns = new Set<string>();
      for (const { runId, scheduleId } of swept) {
        if (!runId || deliveredRuns.has(runId)) continue;
        deliveredRuns.add(runId);
        await deliverRunResultsIfDone(store, { runId, scheduleId });
      }
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
 * §INBOX T2 process-on-arrival: enqueue a schedule's inbox right after email
 * ingestion, WITHOUT stamping `lastRunAt`. `lastRunAt` is the cadence
 * contract — `isScheduleDue` fires when it predates the most recent
 * scheduled occurrence — so stamping it here would make every inbound email
 * silently swallow the next cadence run (and its grouped digest). Arrival
 * enqueues are extra, cadence-independent runs: the cadence still fires at
 * its slot and picks up whatever arrivals didn't claim.
 *
 * Mirrors runDueSchedules' hosted downgrade-skip: the webhook carries no
 * session gate, so when the owner's plan no longer includes schedules this
 * enqueues nothing — the docs stay in the inbox and survive a re-upgrade.
 */
export async function enqueueScheduleArrival(scheduleId: string): Promise<number> {
  if (isHosted()) {
    const schedule = await db.query.schedules.findFirst({ where: eq(schedules.id, scheduleId) });
    if (!schedule || !(await ownerHasSchedules(schedule.userId))) return 0;
  }
  return enqueueInbox(scheduleId);
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
