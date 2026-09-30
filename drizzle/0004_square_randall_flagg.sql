CREATE TABLE `study_schedule_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`subject_id` text NOT NULL,
	`start_minutes` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_schedule_day_position_idx` ON `study_schedule_blocks` (`day`,`position`);--> statement-breakpoint
CREATE TABLE `study_schedule_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`available_days` text DEFAULT '[]' NOT NULL,
	`minutes_per_day` integer DEFAULT 180 NOT NULL,
	`included_subject_ids` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
