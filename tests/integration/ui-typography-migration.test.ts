import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";

it("adds a default UI preference without rewriting existing settings or documents", () => {
  const sqlite = new Database(":memory:");
  try {
    // Replay the exact pre-typography application migrations into a disposable DB.
    for (const file of ["0000_noisy_thanos", "0001_registration_switch", "0002_auth_sessions", "0003_snapshot_retention", "0004_trash_pins"]) {
      sqlite.exec(readFileSync(`drizzle/${file}.sql`, "utf8"));
    }
    sqlite.exec(`
      INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u','migration-user','unused','USER','2026-10-26');
      INSERT INTO user_settings (user_id, theme, auto_save_mode, updated_at) VALUES ('u','dark','300s','2026-10-26');
      INSERT INTO folders (id,user_id,name,created_at,updated_at) VALUES ('f','u','folder','2026-10-26','2026-10-26');
      INSERT INTO notebooks (id,user_id,folder_id,title,created_at,updated_at) VALUES ('n','u','f','notebook','2026-10-26','2026-10-26');
      INSERT INTO pages (id,user_id,notebook_id,content,created_at,updated_at) VALUES ('p','u','n','{"type":"doc","content":[]}','2026-10-26','2026-10-26');
    `);
    const before = sqlite.prepare("SELECT content, version FROM pages WHERE id='p'").get();
    sqlite.exec(readFileSync("drizzle/0005_ui_typography.sql", "utf8"));
    expect(sqlite.prepare("SELECT theme, auto_save_mode, ui_font_size FROM user_settings WHERE user_id='u'").get()).toEqual({ theme: "dark", auto_save_mode: "300s", ui_font_size: "standard" });
    expect(sqlite.prepare("SELECT content, version FROM pages WHERE id='p'").get()).toEqual(before);
  } finally { sqlite.close(); }
});

it("applies the migration journal cleanly on a fresh database and a second run", () => {
  const sqlite = new Database(":memory:");
  try {
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: "drizzle" });
    migrate(db, { migrationsFolder: "drizzle" });
    const columns = sqlite.prepare("PRAGMA table_info(user_settings)").all() as { name: string; dflt_value: string }[];
    expect(columns.filter((column) => column.name === "ui_font_size")).toHaveLength(1);
    expect(columns.find((column) => column.name === "ui_font_size")?.dflt_value).toBe("'standard'");
  } finally { sqlite.close(); }
});
