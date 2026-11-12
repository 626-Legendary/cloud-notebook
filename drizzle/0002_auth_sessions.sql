CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`jti_hash` text NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`device_label` text DEFAULT '未知浏览器' NOT NULL,
	`created_at` text NOT NULL,
	`last_active_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_jti_hash_unique` ON `auth_sessions` (`jti_hash`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_owner_idx` ON `auth_sessions` (`user_id`,`revoked_at`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_activity_idx` ON `auth_sessions` (`last_active_at`);
