import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sqlite: undefined as unknown as Database.Database }));
vi.mock("@/db", () => ({ get sqlite() { return state.sqlite; } }));
import { scanAssetInventory, cleanupOrphanAssets } from "@/lib/asset-cleanup";

const migrationsFolder = path.resolve("drizzle");
let directory: string;
let admin: string, owner: string;
const now = new Date().toISOString();
beforeEach(() => {
  state.sqlite = new Database(":memory:"); state.sqlite.pragma("foreign_keys=ON");
  migrate(drizzle(state.sqlite), { migrationsFolder });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "notebook-missing-assets-"));
  fs.mkdirSync(path.join(directory, "data/uploads/notes"), { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  admin = randomUUID(); owner = randomUUID();
  const insert = state.sqlite.prepare("INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,'unused',?,?)");
  insert.run(admin, "admin", "ADMIN", now); insert.run(owner, "owner", "USER", now);
});
afterEach(() => { vi.restoreAllMocks(); state.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
function missing() {
  const id = randomUUID();
  state.sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?,?,?,'image/png','missing.png',100,?)").run(id, owner, `${id}.png`, now);
  return id;
}
function page(content: string) {
  const folder = randomUUID(), notebook = randomUUID();
  state.sqlite.prepare("INSERT INTO folders (id,user_id,name,created_at,updated_at) VALUES (?,?,'folder',?,?)").run(folder, owner, now, now);
  state.sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,created_at,updated_at) VALUES (?,?,?,'notebook',?,?)").run(notebook, owner, folder, now, now);
  state.sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,content,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), owner, notebook, content, now, now);
}
it("includes safe missing records in batch candidates and deletes records without claiming freed bytes", () => {
  const id = missing();
  const scan = scanAssetInventory({ onlyOrphans: true });
  expect(scan.candidates.map((item) => item.id)).toContain(id);
  expect(scan.candidates[0].status).toBe("file-missing");
  expect(scan.totalCandidates).toBe(1); expect(scan.totalCandidateBytes).toBe(0);
  const result = cleanupOrphanAssets(admin, [id]);
  expect(result).toMatchObject({ deleted: 1, missingRecords: 1, deletedBytes: 0, reclaimedBytes: 0, failures: [] });
  expect(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assets").get()).toEqual({ n: 0 });
});
it("rechecks references at deletion time and retains a now-referenced missing image", () => {
  const id = missing();
  expect(scanAssetInventory().candidates[0].status).toBe("file-missing");
  page(JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { assetId: id } }] }));
  const result = cleanupOrphanAssets(admin, [id]);
  expect(result.deleted).toBe(0); expect(result.failures).toHaveLength(1);
  expect(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assets").get()).toEqual({ n: 1 });
});
it("retains missing records when documents are ambiguous", () => {
  const id = missing(); page("invalid JSON");
  expect(() => cleanupOrphanAssets(admin, [id])).toThrow("无法解析");
  expect(state.sqlite.prepare("SELECT COUNT(*) AS n FROM assets").get()).toEqual({ n: 1 });
});
