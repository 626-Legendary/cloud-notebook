import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";
it("adds knowledge tables to the prior schema without changing existing notebook/page bytes, versions or timestamps", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-migration-")); const sqlite = new Database(":memory:"); sqlite.pragma("foreign_keys=ON");
  try {
    fs.mkdirSync(path.join(directory,"meta"));
    const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
    const old = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 6) };
    fs.writeFileSync(path.join(directory,"meta/_journal.json"), JSON.stringify(old)); for (const entry of old.entries) fs.copyFileSync(`drizzle/${entry.tag}.sql`, path.join(directory, `${entry.tag}.sql`));
    migrate(drizzle(sqlite), { migrationsFolder: directory });
    const user=randomUUID(), folder=randomUUID(), notebook=randomUUID(), page=randomUUID(), now="2026-11-01T12:00:00.000Z";
    sqlite.prepare("INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,'unused',?)").run(user,user,now);
    sqlite.prepare("INSERT INTO folders (id,user_id,name,is_default,created_at,updated_at) VALUES (?,?,'旧默认',1,?,?)").run(folder,user,now,now);
    sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,created_at,updated_at) VALUES (?,?,?,'旧笔记本',?,?)").run(notebook,user,folder,now,now);
    const content=JSON.stringify({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"保留原始正文和格式",marks:[{type:"bold"}]}]}]});
    sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,title,content,version,created_at,updated_at) VALUES (?,?,?,'原页面',?,17,?,?)").run(page,user,notebook,content,now,now);
    const before=sqlite.prepare("SELECT * FROM pages WHERE id=?").get(page);
    migrate(drizzle(sqlite), { migrationsFolder: "drizzle" }); migrate(drizzle(sqlite), { migrationsFolder: "drizzle" });
    expect(sqlite.prepare("SELECT * FROM pages WHERE id=?").get(page)).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_entries").get()).toEqual({n:0}); expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally { sqlite.close(); fs.rmSync(directory,{recursive:true,force:true}); }
});
