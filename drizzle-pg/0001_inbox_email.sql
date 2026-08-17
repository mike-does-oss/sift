ALTER TABLE "documents" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "inbound_token" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "ingest_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "process_on_arrival" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "allowed_senders" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "dataset_id" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_inbound_token_unique" UNIQUE("inbound_token");