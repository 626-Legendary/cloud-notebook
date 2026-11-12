import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, expect, it } from "vitest";
import { deleteManagedUser } from "@/lib/admin-user-deletion";

let sqlite: Database.Database;
let directory: string;
let admin: string, owner: string, other: string;
const now = new Date().toISOString();
beforeEach(() => {
  sqlite = new Database(":memory:"); sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: "drizzle" });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "notebook-delete-user-"));
  admin = randomUUID(); owner = randomUUID(); other = randomUUID();
  const insert = sqlite.prepare("INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,'unused',?,?)");
  insert.run(admin, "admin", "ADMIN", now); insert.run(owner, "owner", "USER", now); insert.run(other, "other", "USER", now);
});
afterEach(() => { sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
function asset(storagePath?: string) {
  const id = randomUUID(); const file = storagePath ?? `${id}.png`;
  sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?, ?, ?, 'image/png','test.png',4,?)").run(id, owner, file, now);
  return { id, file };
}

it("cascades user data and sessions, removes only owned files, and records the deletion", () => {
  const image = asset(); fs.writeFileSync(path.join(directory, image.file), "data");
  const missing = asset();
  const folder = randomUUID(), notebook = randomUUID(), page = randomUUID();
  sqlite.prepare("INSERT INTO folders (id,user_id,name,created_at,updated_at) VALUES (?,?,'folder',?,?)").run(folder, owner, now, now);
  sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,cover_asset_id,created_at,updated_at) VALUES (?,?,?,'notebook',?,?,?)").run(notebook, owner, folder, image.id, now, now);
  sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,content,created_at,updated_at) VALUES (?,?,?,'{}',?,?)").run(page, owner, notebook, now, now);
  sqlite.prepare("INSERT INTO note_snapshots (id,user_id,page_id,title,content,created_at) VALUES (?,?,?,'snap','{}',?)").run(randomUUID(), owner, page, now);
  sqlite.prepare("INSERT INTO user_settings (user_id,updated_at) VALUES (?,?)").run(owner, now);
  sqlite.prepare("INSERT INTO auth_sessions (id,user_id,jti_hash,created_at,last_active_at,expires_at) VALUES (?,?,'hash',?,?,?)").run(randomUUID(), owner, now, now, now);
  const result = deleteManagedUser(sqlite, directory, admin, owner);
  expect(result).toMatchObject({ deletedAssets: 2, missingFiles: 1, pendingFiles: 0 });
  for (const table of ["users", "user_settings", "auth_sessions", "folders", "notebooks", "pages", "note_snapshots", "assets"]) {
    const column = table === "users" ? "id" : "user_id";
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(owner)).toEqual({ n: 0 });
  }
  expect(fs.existsSync(path.join(directory, image.file))).toBe(false);
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id IN (?,?)").get(admin, other)).toEqual({ n: 2 });
  expect(sqlite.prepare("SELECT target_user_id AS target FROM admin_audit_logs").get()).toEqual({ target: owner });
  expect(missing.id).toBeTruthy();
});

it("restores quarantined files and all records if a later unsafe asset aborts deletion", () => {
  const valid = asset(); fs.writeFileSync(path.join(directory, valid.file), "data");
  asset("../unsafe.png");
  expect(() => deleteManagedUser(sqlite, directory, admin, owner)).toThrow("图片路径不安全");
  expect(fs.readFileSync(path.join(directory, valid.file), "utf8")).toBe("data");
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id=?").get(owner)).toEqual({ n: 1 });
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM assets WHERE user_id=?").get(owner)).toEqual({ n: 2 });
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs").get()).toEqual({ n: 0 });
});

it("refuses administrator deletion and protects cross-account image references", () => {
  expect(() => deleteManagedUser(sqlite, directory, admin, admin)).toThrow("普通用户不存在");
  const image = asset(); fs.writeFileSync(path.join(directory, image.file), "data");
  const folder = randomUUID();
  sqlite.prepare("INSERT INTO folders (id,user_id,name,created_at,updated_at) VALUES (?,?,'other',?,?)").run(folder, other, now, now);
  sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,cover_asset_id,created_at,updated_at) VALUES (?,?,?,'foreign',?,?,?)").run(randomUUID(), other, folder, image.id, now, now);
  expect(() => deleteManagedUser(sqlite, directory, admin, owner)).toThrow("交叉引用");
  expect(fs.existsSync(path.join(directory, image.file))).toBe(true);
});

it("rolls back cascading data deletion and file moves when the audit insert fails", () => {
  const image = asset(); fs.writeFileSync(path.join(directory, image.file), "data");
  expect(() => deleteManagedUser(sqlite, directory, randomUUID(), owner)).toThrow(/FOREIGN KEY/);
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id=?").get(owner)).toEqual({ n: 1 });
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM assets WHERE user_id=?").get(owner)).toEqual({ n: 1 });
  expect(fs.readFileSync(path.join(directory, image.file), "utf8")).toBe("data");
});
