CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"total_count" integer NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"output_dir" text,
	"output_format" text DEFAULT 'csv' NOT NULL,
	"keep_results" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"row" jsonb NOT NULL,
	"source_job_id" text,
	"added_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"headers" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_path" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"schedule_id" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "documents_file_path_unique" UNIQUE("file_path")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"document_id" text,
	"template_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"source" text NOT NULL,
	"batch_id" text,
	"schedule_id" text,
	"run_id" text,
	"provider" text,
	"model" text,
	"used_byo_key" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"cadence" text NOT NULL,
	"hour_utc" integer NOT NULL,
	"day_of_week" integer,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"output_dir" text,
	"output_format" text DEFAULT 'csv' NOT NULL,
	"keep_results" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "settings_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"extract_multiple" boolean DEFAULT false NOT NULL,
	"examples" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_id" text NOT NULL,
	"email" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text,
	"encrypted_anthropic_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_id_unique" UNIQUE("auth_id")
);
--> statement-breakpoint
CREATE INDEX "dataset_rows_dataset_id_idx" ON "dataset_rows" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "jobs" USING btree ("created_at");