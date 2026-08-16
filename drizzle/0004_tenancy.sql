ALTER TABLE `batches` ADD `user_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `dataset_rows` ADD `user_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `datasets` ADD `user_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `user_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `user_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `used_byo_key` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `user_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `user_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates` ADD `user_id` text DEFAULT 'local' NOT NULL;