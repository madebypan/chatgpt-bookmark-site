CREATE TABLE `file_search_documents` (
	`bookmark_id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`display_name` text NOT NULL,
	`store_name` text,
	`document_name` text,
	`remote_revision` text,
	`operation_name` text,
	`operation_revision` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`indexed_at` text,
	`last_attempted_at` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_search_documents_status_updated_idx` ON `file_search_documents` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `file_search_documents_store_document_idx` ON `file_search_documents` (`store_name`,`document_name`);--> statement-breakpoint
CREATE TABLE `file_search_garbage` (
	`document_name` text PRIMARY KEY NOT NULL,
	`store_name` text NOT NULL,
	`reason` text NOT NULL,
	`last_attempted_at` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_search_garbage_updated_idx` ON `file_search_garbage` (`updated_at`);--> statement-breakpoint
CREATE TABLE `file_search_stores` (
	`id` text PRIMARY KEY NOT NULL,
	`store_name` text,
	`display_name` text NOT NULL,
	`embedding_model` text NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_search_stores_store_name_unique` ON `file_search_stores` (`store_name`);--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `source_revision` text;--> statement-breakpoint
CREATE VIRTUAL TABLE `bookmark_chunks_fts` USING fts5(
	`title`,
	`site_name`,
	`author`,
	`heading`,
	`content`,
	content='bookmark_chunks',
	content_rowid='rowid',
	tokenize='trigram'
);--> statement-breakpoint
CREATE TRIGGER `bookmark_chunks_fts_after_insert` AFTER INSERT ON `bookmark_chunks` BEGIN
	INSERT INTO `bookmark_chunks_fts`(rowid, title, site_name, author, heading, content)
	VALUES (new.rowid, new.title, new.site_name, new.author, new.heading, new.content);
END;--> statement-breakpoint
CREATE TRIGGER `bookmark_chunks_fts_after_delete` AFTER DELETE ON `bookmark_chunks` BEGIN
	INSERT INTO `bookmark_chunks_fts`(`bookmark_chunks_fts`, rowid, title, site_name, author, heading, content)
	VALUES ('delete', old.rowid, old.title, old.site_name, old.author, old.heading, old.content);
END;--> statement-breakpoint
CREATE TRIGGER `bookmark_chunks_fts_after_update` AFTER UPDATE ON `bookmark_chunks` BEGIN
	INSERT INTO `bookmark_chunks_fts`(`bookmark_chunks_fts`, rowid, title, site_name, author, heading, content)
	VALUES ('delete', old.rowid, old.title, old.site_name, old.author, old.heading, old.content);
	INSERT INTO `bookmark_chunks_fts`(rowid, title, site_name, author, heading, content)
	VALUES (new.rowid, new.title, new.site_name, new.author, new.heading, new.content);
END;--> statement-breakpoint
INSERT INTO `bookmark_chunks_fts`(`bookmark_chunks_fts`) VALUES ('rebuild');
