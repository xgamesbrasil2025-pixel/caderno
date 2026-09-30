CREATE TABLE `topic_state` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`summary_html` text DEFAULT '' NOT NULL,
	`review_text` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`total_seconds` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`topic_id` text NOT NULL,
	`topic_name` text NOT NULL,
	`subject_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` text NOT NULL,
	`seconds` integer NOT NULL,
	`studied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flashcards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` text NOT NULL,
	`topic_name` text NOT NULL,
	`subject_name` text NOT NULL,
	`priority` text NOT NULL,
	`source_review` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`due_at` text NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` text,
	`created_at` text NOT NULL
);
