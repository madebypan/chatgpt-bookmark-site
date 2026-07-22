CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`site_name` text DEFAULT '' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`published_at` text,
	`lang` text,
	`content_type` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`excerpt` text DEFAULT '' NOT NULL,
	`markdown_key` text,
	`raw_key` text,
	`image_url` text,
	`favicon_url` text,
	`word_count` integer DEFAULT 0 NOT NULL,
	`fetch_method` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_canonical_url_unique` ON `bookmarks` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `bookmarks_created_at_idx` ON `bookmarks` (`created_at`);--> statement-breakpoint
CREATE INDEX `bookmarks_status_created_at_idx` ON `bookmarks` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `bookmarks_updated_at_idx` ON `bookmarks` (`updated_at`);