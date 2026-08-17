import { pgTable, text, integer, boolean, timestamp, jsonb, index, primaryKey } from "drizzle-orm/pg-core";

// Hosted-profile (Postgres) twin of `schema.sqlite.ts`. Same table names,
// column names, and logical shape; column types chosen so the runtime JS
// values match the sqlite mappings exactly (see plan §SaaS-1 decision 2):
//   integer timestamp_ms  ↔ timestamptz mode:"date"   (both yield Date)
//   integer boolean       ↔ boolean
//   text json             ↔ jsonb
//   text enums stay text enums (no pg enums)
// Differences: `userId` has NO default here (a missing tenant stamp must fail
// loudly), `settings` is keyed by (user_id, key), and the pg-only `users`
// table holds auth/billing state.

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date());
const userId = () => text("user_id").notNull();

// Hosted-only: one row per auth-provider user. `authId` is the Neon Auth
// (Better Auth) user id — the donor called this `clerkId`; renamed here.
export const users = pgTable("users", {
  id: id(),
  authId: text("auth_id").notNull().unique(),
  email: text("email").notNull(),
  plan: text("plan", { enum: ["free", "starter", "pro", "business"] }).notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  encryptedAnthropicKey: text("encrypted_anthropic_key"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const templates = pgTable("templates", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  fields: jsonb("fields").notNull(),
  prompt: text("prompt").notNull().default(""),
  extractMultiple: boolean("extract_multiple").notNull().default(false),
  // §T3 few-shot examples — nullable, `Array<{ output: Record<string, unknown> }>` (see `src/lib/template-examples.ts`).
  examples: jsonb("examples"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const documents = pgTable("documents", {
  id: id(),
  userId: userId(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull().unique(),
  sizeBytes: integer("size_bytes").notNull(),
  scheduleId: text("schedule_id"),
  // §INBOX: Resend provider email id the document was ingested from —
  // idempotency key for webhook redelivery (checked per schedule). Null for
  // manual uploads.
  sourceMessageId: text("source_message_id"),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
});

// §output-dest: shared by `batches` and `schedules` — see `schema.sqlite.ts`.
const outputDir = () => text("output_dir");
const outputFormat = () => text("output_format", { enum: ["csv", "json", "both"] }).notNull().default("csv");
const keepResults = () => boolean("keep_results").notNull().default(true);

export const batches = pgTable("batches", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  templateSnapshot: jsonb("template_snapshot").notNull(),
  totalCount: integer("total_count").notNull(),
  completedCount: integer("completed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  outputDir: outputDir(),
  outputFormat: outputFormat(),
  keepResults: keepResults(),
  createdAt: createdAt(),
});

export const jobs = pgTable("jobs", {
  id: id(),
  userId: userId(),
  documentId: text("document_id"),
  templateSnapshot: jsonb("template_snapshot").notNull(),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  result: jsonb("result"),
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
  // Extractions run with a bring-your-own key are quota-exempt; frozen on the
  // row at enqueue.
  usedByoKey: boolean("used_byo_key").notNull().default(false),
  createdAt: createdAt(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
}, (t) => [index("jobs_status_idx").on(t.status), index("jobs_created_idx").on(t.createdAt)]);

export const schedules = pgTable("schedules", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  cadence: text("cadence", { enum: ["daily", "weekly"] }).notNull(),
  hourUtc: integer("hour_utc").notNull(),
  dayOfWeek: integer("day_of_week"),
  active: boolean("active").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
  outputDir: outputDir(),
  outputFormat: outputFormat(),
  keepResults: keepResults(),
  // §INBOX email-in — see schema.sqlite.ts for per-column docs.
  inboundToken: text("inbound_token").unique(),
  ingestMode: text("ingest_mode", { enum: ["auto", "attachments", "email", "both"] }).notNull().default("auto"),
  processOnArrival: boolean("process_on_arrival").notNull().default(false),
  allowedSenders: text("allowed_senders"),
  datasetId: text("dataset_id"),
  notifyEmail: boolean("notify_email").notNull().default(true),
  createdAt: createdAt(),
});

export const settings = pgTable("settings", {
  key: text("key").notNull(),
  userId: userId(),
  value: text("value").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })]);

export const datasets = pgTable("datasets", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  headers: jsonb("headers").notNull(),
  createdAt: createdAt(),
});

export const datasetRows = pgTable("dataset_rows", {
  id: id(),
  userId: userId(),
  datasetId: text("dataset_id").notNull(),
  row: jsonb("row").notNull(),
  sourceJobId: text("source_job_id"),
  addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date()),
}, (t) => [index("dataset_rows_dataset_id_idx").on(t.datasetId)]);

export type DbUser = typeof users.$inferSelect;
