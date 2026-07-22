CREATE TABLE `oauth_token_families` (
	`family_id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_token_families_client_active_idx` ON `oauth_token_families` (`client_id`,`revoked_at`,`expires_at`);