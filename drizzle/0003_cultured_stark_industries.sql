CREATE TABLE `agent_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_hint` text NOT NULL,
	`scopes` text DEFAULT '["search","read","recent"]' NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`rate_window_started_at` text,
	`rate_window_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_clients_token_hash_unique` ON `agent_clients` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_clients_active_created_at_idx` ON `agent_clients` (`revoked_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `bookmark_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`bookmark_id` text NOT NULL,
	`revision` text NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`site_name` text DEFAULT '' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`heading` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmark_chunks_bookmark_revision_ordinal_unique` ON `bookmark_chunks` (`bookmark_id`,`revision`,`ordinal`);--> statement-breakpoint
CREATE INDEX `bookmark_chunks_active_revision_idx` ON `bookmark_chunks` (`bookmark_id`,`revision`,`ordinal`);--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `search_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `search_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `search_content_hash` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `search_chunk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `search_indexed_at` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `search_index_error` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `search_truncated` integer DEFAULT 0 NOT NULL;