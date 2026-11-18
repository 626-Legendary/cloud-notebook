CREATE TABLE knowledge_entries (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 deleted_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX knowledge_entries_owner_idx ON knowledge_entries(user_id,deleted_at,updated_at);
--> statement-breakpoint
CREATE TABLE knowledge_names (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 normalized_name TEXT NOT NULL,
 entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('title','alias')),
 PRIMARY KEY(user_id,normalized_name)
);
--> statement-breakpoint
CREATE INDEX knowledge_names_entry_idx ON knowledge_names(entry_id);
--> statement-breakpoint
CREATE TABLE tags (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 normalized_name TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX tags_owner_name_idx ON tags(user_id,normalized_name);
--> statement-breakpoint
CREATE TABLE content_tags (
 tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
 source_type TEXT NOT NULL CHECK (source_type IN ('page','entry')),
 source_id TEXT NOT NULL,
 PRIMARY KEY(tag_id,source_type,source_id)
);
--> statement-breakpoint
CREATE INDEX content_tags_source_idx ON content_tags(source_type,source_id);
--> statement-breakpoint
CREATE TRIGGER knowledge_tags_delete AFTER DELETE ON knowledge_entries BEGIN DELETE FROM content_tags WHERE source_type='entry' AND source_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER page_tags_delete AFTER DELETE ON pages BEGIN DELETE FROM content_tags WHERE source_type='page' AND source_id=OLD.id; END;
