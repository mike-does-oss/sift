import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());
// Tenancy (§SaaS-1): the local profile is single-user, so every row belongs to
// the constant user "local" — scoping code can then be identical across
// profiles (the hosted pg schema has the same column, minus the default).
const userId = () => text("user_id").notNull().default("local");

export const templates = sqliteTable("templates", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  fields: text("fields", { mode: "json" }).notNull(),
  prompt: text("prompt").notNull().default(""),
  extractMultiple: integer("extract_multiple", { mode: "boolean" }).notNull().default(false),
  // §T3 few-shot examples — nullable, `Array<{ output: Record<string, unknown> }>` (see `src/lib/template-examples.ts`).
  examples: text("examples", { mode: "json" }),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const documents = sqliteTable("documents", {
  id: id(),
  userId: userId(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull().unique(),
  sizeBytes: integer("size_bytes").notNull(),
  scheduleId: text("schedule_id"),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

// §output-dest: `outputDir`/`outputFormat`/`keepResults` are shared by
// `batches` and `schedules` — when `outputDir` is set, the worker writes
// completed results to that folder (see `src/lib/output-writer.ts`) once the
// batch/run finishes, and `keepResults = false` nulls the DB copy afterward
// (status/error columns are always kept).
const outputDir = () => text("output_dir");
const outputFormat = () => text("output_format", { enum: ["csv", "json", "both"] }).notNull().default("csv");
const keepResults = () => integer("keep_results", { mode: "boolean" }).notNull().default(true);

export const batches = sqliteTable("batches", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  templateSnapshot: text("template_snapshot", { mode: "json" }).notNull(),
  totalCount: integer("total_count").notNull(),
  completedCount: integer("completed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  outputDir: outputDir(),
  outputFormat: outputFormat(),
  keepResults: keepResults(),
  createdAt: createdAt(),
});

export const jobs = sqliteTable("jobs", {
  id: id(),
  userId: userId(),
  documentId: text("document_id"),
  templateSnapshot: text("template_snapshot", { mode: "json" }).notNull(),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  result: text("result", { mode: "json" }),
  error: text("error"),
  source: text("source", { enum: ["single", "batch", "schedule"] }).notNull(),
  batchId: text("batch_id"),
  scheduleId: text("schedule_id"),
  // One uuid per `enqueueInbox` invocation (schedule jobs only — batch jobs
  // group by `batchId` instead) so a single scheduled run's jobs can be
  // gathered together once they've all reached a terminal state.
  runId: text("run_id"),
  provider: text("provider"),
  model: text("model"),
  // Hosted profile: extractions run with a bring-your-own key are
  // quota-exempt; frozen on the row at enqueue. Always false on local.
  usedByoKey: integer("used_byo_key", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (t) => [index("jobs_status_idx").on(t.status), index("jobs_created_idx").on(t.createdAt)]);

export const schedules = sqliteTable("schedules", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  cadence: text("cadence", { enum: ["daily", "weekly"] }).notNull(),
  hourUtc: integer("hour_utc").notNull(),
  dayOfWeek: integer("day_of_week"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  outputDir: outputDir(),
  outputFormat: outputFormat(),
  keepResults: keepResults(),
  createdAt: createdAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").notNull(),
  userId: userId(),
  value: text("value").notNull(),
}, (t) => [
  // Composite PK matching the pg schema exactly, so the settings upsert can
  // use the same `ON CONFLICT (user_id, key)` target on both dialects
  // (sqlite rejects a conflict target that has no matching unique index).
  primaryKey({ columns: [t.userId, t.key] }),
]);

export const datasets = sqliteTable("datasets", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  headers: text("headers", { mode: "json" }).notNull(),
  createdAt: createdAt(),
});

export const datasetRows = sqliteTable("dataset_rows", {
  id: id(),
  userId: userId(),
  datasetId: text("dataset_id").notNull(),
  row: text("row", { mode: "json" }).notNull(),
  sourceJobId: text("source_job_id"),
  addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [index("dataset_rows_dataset_id_idx").on(t.datasetId)]);

export type DbTemplate = typeof templates.$inferSelect;
export type DbDocument = typeof documents.$inferSelect;
export type DbBatch = typeof batches.$inferSelect;
export type DbJob = typeof jobs.$inferSelect;
export type DbSchedule = typeof schedules.$inferSelect;
export type DbDataset = typeof datasets.$inferSelect;
export type DbDatasetRow = typeof datasetRows.$inferSelect;
