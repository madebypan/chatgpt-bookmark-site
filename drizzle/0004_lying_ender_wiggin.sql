CREATE TABLE `oauth_access_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`token_hint` text NOT NULL,
	`family_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_client_active_idx` ON `oauth_access_tokens` (`client_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_family_idx` ON `oauth_access_tokens` (`family_id`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_codes_client_expires_idx` ON `oauth_authorization_codes` (`client_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_requests` (
	`transaction_hash` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`state` text,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`decision` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_authorization_requests_client_expires_idx` ON `oauth_authorization_requests` (`client_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`client_uri` text,
	`redirect_uris` text NOT NULL,
	`grant_types` text NOT NULL,
	`response_types` text NOT NULL,
	`token_endpoint_auth_method` text DEFAULT 'none' NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_clients_active_created_at_idx` ON `oauth_clients` (`revoked_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_rate_limits_updated_at_idx` ON `oauth_rate_limits` (`updated_at`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`token_hint` text NOT NULL,
	`family_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_client_active_idx` ON `oauth_refresh_tokens` (`client_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_family_idx` ON `oauth_refresh_tokens` (`family_id`);