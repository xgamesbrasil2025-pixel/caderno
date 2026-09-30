ALTER TABLE `flashcards` ADD `source_summary_id` text;
--> statement-breakpoint
CREATE INDEX `flashcards_source_summary_idx` ON `flashcards` (`source_summary_id`);
--> statement-breakpoint
ALTER TABLE `summaries` ADD `review_text` text DEFAULT '' NOT NULL;
