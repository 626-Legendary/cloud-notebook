ALTER TABLE `notebooks` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `notebooks` ADD `pinned_at` text;
--> statement-breakpoint
ALTER TABLE `notebooks` ADD `pin_sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `pages` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `pages` ADD `pinned_at` text;
--> statement-breakpoint
ALTER TABLE `pages` ADD `pin_sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `notebooks_deleted_idx` ON `notebooks` (`user_id`,`deleted_at`);
--> statement-breakpoint
CREATE INDEX `pages_deleted_idx` ON `pages` (`user_id`,`deleted_at`);
