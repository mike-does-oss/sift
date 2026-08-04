ALTER TABLE `batches` ADD `output_dir` text;--> statement-breakpoint
ALTER TABLE `batches` ADD `output_format` text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE `batches` ADD `keep_results` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `output_dir` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `output_format` text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `keep_results` integer DEFAULT true NOT NULL;