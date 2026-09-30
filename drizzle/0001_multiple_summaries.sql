CREATE TABLE `summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`title` text DEFAULT 'Resumo' NOT NULL,
	`content_html` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `summaries_topic_idx` ON `summaries` (`topic_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `summaries` (`id`, `topic_id`, `title`, `content_html`, `created_at`, `updated_at`)
SELECT 'legacy-' || `topic_id`, `topic_id`, 'Resumo principal', `summary_html`, `updated_at`, `updated_at`
FROM `topic_state`
WHERE length(trim(
	replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
		`summary_html`, '<br>', ''), '&nbsp;', ''), ' ', ''), '<h1>', ''), '</h1>', ''), '<h2>', ''), '</h2>', ''),
		'<div>', ''), '</div>', ''), '<b>', ''), '</b>', ''), '<span style="background-color: rgb(254, 240, 138);">', ''), '</span>', '')
)) > 0;
