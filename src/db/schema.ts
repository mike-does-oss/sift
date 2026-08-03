import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());

export const templates = sqliteTable("templates", {
  id: id(),
  name: text("name").notNull(),
  fields: text("fields", { mode: "json" }).notNull(),
  prompt: text("prompt").notNull().default(""),
  extractMultiple: integer("extract_multiple", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const documents = sqliteTable("documents", {
  id: id(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull().unique(),
  sizeBytes: integer("size_bytes").notNull(),
  scheduleId: text("schedule_id"),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const batches = sqliteTable("batches", {
  id: id(),
  name: text("name").notNull(),
  templateSnapshot: text("template_snapshot", { mode: "json" }).notNull(),
  totalCount: integer("total_count").notNull(),
  completedCount: integer("completed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: createdAt(),
});

export const jobs = sqliteTable("jobs", {
  id: id(),
  documentId: text("document_id"),
  templateSnapshot: text("template_snapshot", { mode: "json" }).notNull(),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  result: text("result", { mode: "json" }),
  error: text("error"),
  source: text("source", { enum: ["single", "batch", "schedule"] }).notNull(),
  batchId: text("batch_id"),
  scheduleId: text("schedule_id"),
  provider: text("provider"),
  model: text("model"),
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (t) => [index("jobs_status_idx").on(t.status), index("jobs_created_idx").on(t.createdAt)]);

export const schedules = sqliteTable("schedules", {
  id: id(),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  cadence: text("cadence", { enum: ["daily", "weekly"] }).notNull(),
  hourUtc: integer("hour_utc").notNull(),
  dayOfWeek: integer("day_of_week"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const datasets = sqliteTable("datasets", {
  id: id(),
  name: text("name").notNull(),
  headers: text("headers", { mode: "json" }).notNull(),
  createdAt: createdAt(),
});

export const datasetRows = sqliteTable("dataset_rows", {
  id: id(),
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
