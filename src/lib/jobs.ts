import { eq, and } from "drizzle-orm";
import { db, getSqlite } from "@/db";
import { jobs, documents, schedules, templates, batches } from "@/db/schema";
import { runExtraction } from "@/lib/extraction";
import { readDocument } from "@/lib/storage";
import { parseDocument } from "@/lib/documents";
import { isScheduleDue } from "@/lib/schedule";
import { jobsToRows } from "@/lib/export";
import { writeOutputs } from "@/lib/output-writer";
import type { ExtractionField, TemplateExample } from "@/types";

// Raw sqlite is local-profile only; the hosted job store lands in a later
// task (§SaaS-1 T3) — until then this module must not load on hosted.
const sqlite = getSqlite();

const MAX_ATTEMPTS = 3;
const STALE_MS = 10 * 60 * 1000; // keep < any future long-running change; single process makes staleness rare

// §T3: examples are mode-independent — carried through regardless of source
// (single/batch/schedule) — unlike `grounded`, which jobs/batches never set.
interface Snapshot { fields: ExtractionField[]; prompt: string; extractMultiple: boolean; examples?: TemplateExample[] }

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

async function runOne(jobId: string): Promise<void> {
  inFlight.add(jobId);
  try {
    await runOneInner(jobId);
  } finally {
    inFlight.delete(jobId);
  }
}

async function runOneInner(jobId: string): Promise<void> {
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
    const buf = readDocument(doc.filePath);
    const source = await parseDocument(buf, doc.filename);
    const snap = job.templateSnapshot as Snapshot;
    const result = await runExtraction({
      source, filename: doc.filename,
      fields: snap.fields, prompt: snap.prompt, extractMultiple: snap.extractMultiple,
      examples: snap.examples,
    }, undefined, job.userId);
    if (!result.success) throw Object.assign(new Error(result.error), { provider: result.provider, model: result.model });
    await db.update(jobs).set({
      status: "completed", result: result.data, error: null, completedAt: new Date(),
      provider: result.provider, model: result.model,
    }).where(eq(jobs.id, jobId));
    if (job.batchId) sqlite.prepare(`UPDATE batches SET completed_count = completed_count + 1 WHERE id = ?`).run(job.batchId);
    await writeOutputsIfDone(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const terminal = (job.attempts >= MAX_ATTEMPTS) || message.includes("declined to process");
    try {
      await db.update(jobs).set({
        status: "failed", error: message, completedAt: terminal ? new Date() : null,
        provider: (err as { provider?: string }).provider ?? null, model: (err as { model?: string }).model ?? null,
      }).where(eq(jobs.id, jobId));
      if (terminal && job.batchId) sqlite.prepare(`UPDATE batches SET failed_count = failed_count + 1 WHERE id = ?`).run(job.batchId);
      if (terminal) await writeOutputsIfDone(job);
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
 * Best-effort: any failure here is logged and swallowed. An output-write
 * problem must never fail, retry, or otherwise affect a job.
 */
async function writeOutputsIfDone(job: { batchId: string | null; runId: string | null; scheduleId: string | null }): Promise<void> {
  if (job.batchId) {
    try {
      await maybeWriteBatchOutputs(job.batchId);
    } catch (err) {
      console.error("Failed to write batch outputs:", job.batchId, err);
    }
  }
  if (job.runId) {
    try {
      await maybeWriteRunOutputs(job.runId, job.scheduleId);
    } catch (err) {
      console.error("Failed to write schedule run outputs:", job.runId, err);
    }
  }
}

async function maybeWriteBatchOutputs(batchId: string): Promise<void> {
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
    sqlite.prepare(`UPDATE jobs SET result = NULL WHERE batch_id = ? AND status = 'completed'`).run(batchId);
  }
}

async function maybeWriteRunOutputs(runId: string, scheduleId: string | null): Promise<void> {
  if (!scheduleId) return;
  const schedule = await db.query.schedules.findFirst({ where: eq(schedules.id, scheduleId) });
  if (!schedule || !schedule.outputDir) return;

  const counts = sqlite.prepare(`
    SELECT
      count(*) AS total,
      sum(CASE WHEN status = 'completed' OR (status = 'failed' AND completed_at IS NOT NULL) THEN 1 ELSE 0 END) AS terminal
    FROM jobs WHERE run_id = ?
  `).get(runId) as { total: number; terminal: number };
  if (counts.total === 0 || counts.terminal < counts.total) return; // not done yet

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
    sqlite.prepare(`UPDATE jobs SET result = NULL WHERE run_id = ? AND status = 'completed'`).run(runId);
  }
}

export async function processPendingJobs(timeBudgetMs: number): Promise<{ processed: number; remaining: number }> {
  const start = Date.now();
  let processed = 0;
  while (Date.now() - start < timeBudgetMs) {
    try {
      const id = claimOne();
      if (!id) break;
      await runOne(id);
      processed++;
    } catch (err) {
      console.error("Worker iteration failed:", err);
      break;
    }
  }
  const remain = sqlite.prepare(`
    SELECT count(*) AS n FROM jobs
    WHERE status = 'pending' OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS} AND completed_at IS NULL)
  `).get() as { n: number };
  return { processed, remaining: remain.n };
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
  // Atomic claim: transaction over sync driver
  const runId = crypto.randomUUID();
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
}

export async function runDueSchedules(now = new Date()): Promise<{ schedulesChecked: number; jobsCreated: number }> {
  const active = await db.query.schedules.findMany({ where: eq(schedules.active, true) });
  let jobsCreated = 0;
  for (const s of active) {
    try {
      if (!isScheduleDue(s, now)) continue;
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
