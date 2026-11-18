import { integer, sqliteTable, text, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["ADMIN", "USER"] }).notNull().default("USER"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: text("created_at").notNull()
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme", { enum: ["system", "light", "dark"] }).notNull().default("system"),
  autoSaveMode: text("auto_save_mode", { enum: ["realtime", "10s", "30s", "60s", "300s", "600s", "off"] }).notNull().default("realtime"),
  uiFontSize: text("ui_font_size", { enum: ["compact", "standard", "large"] }).notNull().default("standard"),
  sidebarCollapsed: integer("sidebar_collapsed", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull()
});

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jtiHash: text("jti_hash").notNull().unique(),
  userAgent: text("user_agent").notNull().default(""),
  deviceLabel: text("device_label").notNull().default("未知浏览器"),
  createdAt: text("created_at").notNull(),
  lastActiveAt: text("last_active_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at")
}, (table) => ({
  ownerIdx: index("auth_sessions_owner_idx").on(table.userId, table.revokedAt, table.expiresAt),
  activityIdx: index("auth_sessions_activity_idx").on(table.lastActiveAt)
}));

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => ({
  ownerIdx: index("folders_user_idx").on(table.userId)
}));

export const notebooks = sqliteTable("notebooks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  folderId: text("folder_id").notNull().references(() => folders.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  coverAssetId: text("cover_asset_id").references(() => assets.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  deletedAt: text("deleted_at"),
  pinnedAt: text("pinned_at"),
  pinSortOrder: integer("pin_sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => ({
  ownerFolderIdx: index("notebooks_user_folder_idx").on(table.userId, table.folderId),
  deletedIdx: index("notebooks_deleted_idx").on(table.userId, table.deletedAt)
}));

export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notebookId: text("notebook_id").notNull().references(() => notebooks.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("无标题"),
  content: text("content").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  pinnedAt: text("pinned_at"),
  pinSortOrder: integer("pin_sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => ({
  ownerNotebookIdx: index("pages_user_notebook_idx").on(table.userId, table.notebookId),
  orderIdx: index("pages_notebook_sort_idx").on(table.notebookId, table.sortOrder),
  deletedIdx: index("pages_deleted_idx").on(table.userId, table.deletedAt)
}));

export const noteSnapshots = sqliteTable("note_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => ({
  pageCreatedIdx: index("snapshots_page_created_idx").on(table.pageId, table.createdAt),
  createdIdx: index("snapshots_created_idx").on(table.createdAt)
}));

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  originalName: text("original_name").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => ({ ownerIdx: index("assets_user_idx").on(table.userId) }));

export const backupRecords = sqliteTable("backup_records", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  size: integer("size").notNull(),
  checksum: text("checksum").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull()
});

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  targetUserId: text("target_user_id"),
  createdAt: text("created_at").notNull()
}, (table) => ({ createdIdx: index("admin_audit_created_idx").on(table.createdAt) }));

export type User = typeof users.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Notebook = typeof notebooks.$inferSelect;
export type Page = typeof pages.$inferSelect;

export const knowledgeEntries = sqliteTable("knowledge_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(), content: text("content").notNull(), version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull()
}, (table) => ({ ownerIdx: index("knowledge_entries_owner_idx").on(table.userId, table.deletedAt, table.updatedAt) }));
export const knowledgeNames = sqliteTable("knowledge_names", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  normalizedName: text("normalized_name").notNull(), entryId: text("entry_id").notNull().references(() => knowledgeEntries.id, { onDelete: "cascade" }),
  name: text("name").notNull(), kind: text("kind", { enum: ["title", "alias"] }).notNull()
}, (table) => ({ pk: primaryKey({ columns: [table.userId, table.normalizedName] }), entryIdx: index("knowledge_names_entry_idx").on(table.entryId) }));
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull()
}, (table) => ({ nameIdx: uniqueIndex("tags_owner_name_idx").on(table.userId, table.normalizedName) }));
export const contentTags = sqliteTable("content_tags", {
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  sourceType: text("source_type", { enum: ["page", "entry"] }).notNull(), sourceId: text("source_id").notNull()
}, (table) => ({ pk: primaryKey({ columns: [table.tagId, table.sourceType, table.sourceId] }), sourceIdx: index("content_tags_source_idx").on(table.sourceType, table.sourceId) }));
export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
