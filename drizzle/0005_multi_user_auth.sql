CREATE TABLE `auth_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`blocked_until` text
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_unique` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_kind_idx` ON `auth_tokens` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_token_unique` ON `user_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `user_sessions_user_idx` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`email_verified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_access_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
DROP INDEX `study_schedule_day_position_idx`;--> statement-breakpoint
ALTER TABLE `study_schedule_blocks` ADD `user_id` text DEFAULT '__legacy_owner__' NOT NULL;--> statement-breakpoint
CREATE INDEX `study_schedule_user_day_position_idx` ON `study_schedule_blocks` (`user_id`,`day`,`position`);--> statement-breakpoint
DROP INDEX `summaries_topic_idx`;--> statement-breakpoint
ALTER TABLE `summaries` ADD `user_id` text DEFAULT '__legacy_owner__' NOT NULL;--> statement-breakpoint
CREATE INDEX `summaries_user_topic_idx` ON `summaries` (`user_id`,`topic_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_study_schedule_settings` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`available_days` text DEFAULT '[]' NOT NULL,
	`minutes_per_day` integer DEFAULT 180 NOT NULL,
	`included_subject_ids` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_study_schedule_settings`("user_id", "id", "available_days", "minutes_per_day", "included_subject_ids", "updated_at") SELECT '__legacy_owner__', "id", "available_days", "minutes_per_day", "included_subject_ids", "updated_at" FROM `study_schedule_settings`;--> statement-breakpoint
DROP TABLE `study_schedule_settings`;--> statement-breakpoint
ALTER TABLE `__new_study_schedule_settings` RENAME TO `study_schedule_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_topic_state` (
	`user_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`summary_html` text DEFAULT '' NOT NULL,
	`review_text` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`total_seconds` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `topic_id`)
);
--> statement-breakpoint
INSERT INTO `__new_topic_state`("user_id", "topic_id", "summary_html", "review_text", "completed", "total_seconds", "updated_at") SELECT '__legacy_owner__', "topic_id", "summary_html", "review_text", "completed", "total_seconds", "updated_at" FROM `topic_state`;--> statement-breakpoint
DROP TABLE `topic_state`;--> statement-breakpoint
ALTER TABLE `__new_topic_state` RENAME TO `topic_state`;--> statement-breakpoint
CREATE INDEX `topic_state_user_idx` ON `topic_state` (`user_id`);--> statement-breakpoint
ALTER TABLE `activities` ADD `user_id` text DEFAULT '__legacy_owner__' NOT NULL;--> statement-breakpoint
CREATE INDEX `activities_user_created_idx` ON `activities` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `flashcards` ADD `user_id` text DEFAULT '__legacy_owner__' NOT NULL;--> statement-breakpoint
CREATE INDEX `flashcards_user_due_idx` ON `flashcards` (`user_id`,`due_at`);--> statement-breakpoint
ALTER TABLE `study_logs` ADD `user_id` text DEFAULT '__legacy_owner__' NOT NULL;--> statement-breakpoint
CREATE INDEX `study_logs_user_idx` ON `study_logs` (`user_id`);--> statement-breakpoint
PRAGMA optimize;
