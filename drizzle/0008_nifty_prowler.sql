CREATE TABLE `error_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_name` text NOT NULL,
	`topic_name` text NOT NULL,
	`priority` text NOT NULL,
	`title` text DEFAULT 'Erro registrado' NOT NULL,
	`mistake` text NOT NULL,
	`correct_answer` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `error_notes_user_updated_idx` ON `error_notes` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `error_notes_user_topic_idx` ON `error_notes` (`user_id`,`topic_id`);--> statement-breakpoint
ALTER TABLE `flashcards` ADD `source_error_id` text;--> statement-breakpoint
CREATE INDEX `flashcards_source_error_idx` ON `flashcards` (`source_error_id`);
--> statement-breakpoint
PRAGMA optimize;
