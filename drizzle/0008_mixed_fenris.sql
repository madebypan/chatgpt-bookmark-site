CREATE TABLE `semantic_embeddings` (
	`chunk_id` text PRIMARY KEY NOT NULL,
	`bookmark_id` text NOT NULL,
	`revision` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`chunk_id`) REFERENCES `bookmark_chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `semantic_embeddings_bookmark_revision_idx` ON `semantic_embeddings` (`bookmark_id`,`revision`);--> statement-breakpoint
CREATE INDEX `semantic_embeddings_model_dimensions_idx` ON `semantic_embeddings` (`model`,`dimensions`);--> statement-breakpoint
CREATE TABLE `semantic_index_state` (
	`id` text PRIMARY KEY NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
