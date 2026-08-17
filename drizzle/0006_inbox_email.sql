ALTER TABLE `documents` ADD `source_message_id` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `inbound_token` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `ingest_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `process_on_arrival` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `allowed_senders` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `dataset_id` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `notify_email` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_inbound_token_unique` ON `schedules` (`inbound_token`);