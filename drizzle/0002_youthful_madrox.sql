CREATE TABLE `capture_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_hint` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`rate_window_started_at` text,
	`rate_window_count` integer DEFAULT 0 NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capture_devices_token_hash_unique` ON `capture_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `capture_devices_active_created_at_idx` ON `capture_devices` (`revoked_at`,`created_at`);