import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { jobs, documents, schedules, templates } from "@/db/schema";
import { runExtraction } from "@/lib/extraction";
import { readDocument } from "@/lib/storage";
import { isScheduleDue } from "@/lib/schedule";
import type { ExtractionField } from "@/types";

const MAX_ATTEMPTS = 3;
const STALE_MS = 10 * 60 * 1000; // keep < any future long-running change; single process makes staleness rare

interface Snapshot { fields: ExtractionField[]; prompt: string; extractMultiple: boolean }

const claimStmt = sqlite.prepare(`
  UPDATE jobs SET status = 'processing', started_at = @now, attempts = attempts + 1
  WHERE id = (
    SELECT id FROM jobs
    WHERE status = 'pending'
       OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS} AND completed_at IS NULL)
       OR (status = 'processing' AND started_at < @stale AND attempts < ${MAX_ATTEMPTS})
    ORDER BY created_at LIMIT 1
  )
  RETURNING id
`);

function claimOne(): string | null {
  const now = Date.now();
  const row = claimStmt.get({ now, stale: now - STALE_MS }) as { id: string } | undefined;
  return row?.id ?? null;
}

async function runOne(jobId: string): Promise<void> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return;
  try {
    if (!job.documentId) throw new Error("Job has no document");
    const doc = await db.query.documents.findFirst({ where: eq(documents.id, job.documentId) });
    if (!doc) throw new Error("Document not found");
    const pdfBase64 = readDocument(doc.filePath).toString("base64");
    const snap = job.templateSnapshot as Snapshot;
    const result = await runExtraction({
      pdfBase64, filename: doc.filename,
      fields: snap.fields, prompt: snap.prompt, extractMultiple: snap.extractMultiple,
    });
    if (!result.success) throw Object.assign(new Error(result.error), { provider: result.provider, model: result.model });
    await db.update(jobs).set({
      status: "completed", result: result.data, error: null, completedAt: new Date(),
      provider: result.provider, model: result.model,
    }).where(eq(jobs.id, jobId));
    if (job.batchId) sqlite.prepare(`UPDATE batches SET completed_count = completed_count + 1 WHERE id = ?`).run(job.batchId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const terminal = (job.attempts >= MAX_ATTEMPTS) || message.includes("declined to process");
    try {
      await db.update(jobs).set({
        status: "failed", error: message, completedAt: terminal ? new Date() : null,
        provider: (err as { provider?: string }).provider ?? null, model: (err as { model?: string }).model ?? null,
      }).where(eq(jobs.id, jobId));
      if (terminal && job.batchId) sqlite.prepare(`UPDATE batches SET failed_count = failed_count + 1 WHERE id = ?`).run(job.batchId);
    } catch (recordErr) {
      console.error("Failed to record job failure:", recordErr);
    }
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
  const template = await db.query.templates.findFirst({ where: eq(templates.id, schedule.templateId) });
  if (!template) return 0;
  const snapshot = { fields: template.fields, prompt: template.prompt, extractMultiple: template.extractMultiple };
  // Atomic claim: transaction over sync driver
  const tx = sqlite.transaction(() => {
    const inbox = sqlite.prepare(
      `SELECT id FROM documents WHERE schedule_id = ? AND processed_at IS NULL`
    ).all(schedule.id) as Array<{ id: string }>;
    const insert = sqlite.prepare(`
      INSERT INTO jobs (id, document_id, template_snapshot, source, schedule_id, status, attempts, created_at)
      VALUES (?, ?, ?, 'schedule', ?, 'pending', 0, ?)
    `);
    const mark = sqlite.prepare(`UPDATE documents SET processed_at = ? WHERE id = ?`);
    const now = Date.now();
    for (const d of inbox) {
      insert.run(crypto.randomUUID(), d.id, JSON.stringify(snapshot), schedule.id, now);
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
