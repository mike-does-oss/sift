CREATE TABLE `dataset_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`row` text NOT NULL,
	`source_job_id` text,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dataset_rows_dataset_id_idx` ON `dataset_rows` (`dataset_id`);--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`headers` text NOT NULL,
	`created_at` integer NOT NULL
);
