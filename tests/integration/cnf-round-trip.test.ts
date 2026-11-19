import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeDocument } from "../fixtures/native-document";
const state = vi.hoisted(() => ({ sqlite: undefined as unknown as Database.Database }));
vi.mock("@/db", () => ({ get sqlite() { return state.sqlite; } }));
import { exportNotebookCnf, importNotebookCnf } from "@/lib/cnf";
import { parseCnf, createCnfZip, sha256 } from "@/lib/cnf-format";

const migrationsFolder = path.resolve("drizzle");
const image = fs.readFileSync("tests/fixtures/cover.png");
const now = "2026-11-10T12:00:00.000Z";
let directory: string, owner: string, other: string, notebookId: string, assetId: string, firstPage: string;
beforeEach(() => {
  state.sqlite = new Database(":memory:"); state.sqlite.pragma("foreign_keys=ON");
  migrate(drizzle(state.sqlite), { migrationsFolder });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cnf-roundtrip-"));
  fs.mkdirSync(path.join(directory, "data/uploads/notes"), { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  owner = randomUUID(); other = randomUUID(); notebookId = randomUUID(); assetId = randomUUID(); firstPage = randomUUID();
  for (const [id, username] of [[owner, "owner"], [other, "other"]]) {
    state.sqlite.prepare("INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,'unused','USER',?)").run(id, username, now);
    state.sqlite.prepare("INSERT INTO folders (id,user_id,name,is_default,created_at,updated_at) VALUES (?,?,'默认',1,?,?)").run(randomUUID(), id, now, now);
  }
  fs.writeFileSync(path.join(directory, `data/uploads/notes/${assetId}.png`), image);
  state.sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?,?,?,'image/png','封面.png',?,?)").run(assetId, owner, `${assetId}.png`, image.length, now);
  const folder = state.sqlite.prepare("SELECT id FROM folders WHERE user_id=?").get(owner) as { id: string };
  state.sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,cover_asset_id,sort_order,pinned_at,pin_sort_order,created_at,updated_at) VALUES (?,?,?,'完整原生笔记本',?,10,?,2,?,?)").run(notebookId, owner, folder.id, assetId, now, now, now);
  const insert = state.sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,title,content,sort_order,deleted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  insert.run(firstPage, owner, notebookId, "第一页", JSON.stringify(nativeDocument(assetId)), 5, null, now, now);
  insert.run(randomUUID(), owner, notebookId, "第二页", JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }), 12, null, now, now);
  insert.run(randomUUID(), owner, notebookId, "垃圾箱页面", JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }), 15, now, now, now);
  state.sqlite.prepare("INSERT INTO note_snapshots (id,user_id,page_id,title,content,created_at) VALUES (?,?,?,'历史版本',?,?)").run(randomUUID(), owner, firstPage, JSON.stringify(nativeDocument(assetId)), now);
});
afterEach(() => { vi.restoreAllMocks(); state.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });

it("round-trips all rich nodes, metadata, history, trash and one deduplicated cover/image to another owner, then exports again", async () => {
  const exported = await exportNotebookCnf(owner, notebookId);
  expect(exported.filename).toBe("完整原生笔记本.cnf");
  const before = await parseCnf(exported.bytes);
  expect(before.manifest.assets).toHaveLength(1);
  expect(JSON.stringify(before.notebook)).not.toContain(owner);
  expect(JSON.stringify(before.manifest)).not.toContain("password");
  const imported = await importNotebookCnf(other, exported.bytes);
  expect(imported.id).not.toBe(notebookId);
  const secondExport = await exportNotebookCnf(other, imported.id);
  const after = await parseCnf(secondExport.bytes);
  expect(after.notebook.title).toBe(before.notebook.title);
  expect(after.notebook.pages.map((page) => [page.title, page.sortOrder, page.deletedAt])).toEqual(before.notebook.pages.map((page) => [page.title, page.sortOrder, page.deletedAt]));
  expect(after.notebook.createdAt).toBe(before.notebook.createdAt);
  expect(after.notebook.pinnedAt).toBe(before.notebook.pinnedAt);
  expect(after.notebook.snapshots).toHaveLength(1);
  const newAsset = after.manifest.assets[0];
  const canonical = (value: unknown, id: string, file: string) => JSON.stringify(value).replaceAll(id, "ASSET").replaceAll(file, "ASSET_FILE");
  expect(canonical(after.notebook.pages[0].content, newAsset.id, newAsset.path)).toBe(canonical(before.notebook.pages[0].content, assetId, before.manifest.assets[0].path));
  expect(after.entries.get(newAsset.path)).toEqual(image);
  expect(after.notebook.pages[0].id).not.toBe(firstPage);
  expect(state.sqlite.prepare("SELECT count(*) AS n FROM notebooks WHERE user_id=?").get(owner)).toEqual({ n: 1 });
});

it("preserves the UI order when pages have identical sorting values and timestamps", async () => {
  state.sqlite.prepare("UPDATE pages SET id='00000000-0000-4000-8000-000000000001' WHERE title='第二页'").run();
  state.sqlite.prepare("UPDATE pages SET sort_order=0").run();
  const original = state.sqlite.prepare("SELECT title FROM pages WHERE notebook_id=? ORDER BY sort_order,created_at").all(notebookId);
  const exported = await exportNotebookCnf(owner, notebookId);
  const archive = await parseCnf(exported.bytes);
  expect(archive.notebook.pages.map((page) => ({ title: page.title }))).toEqual(original);
  const imported = await importNotebookCnf(other, exported.bytes);
  expect(state.sqlite.prepare("SELECT title FROM pages WHERE notebook_id=? ORDER BY sort_order,created_at").all(imported.id)).toEqual(original);
});

it("rejects cross-user exports, missing assets and mismatched asset identifiers without a partial archive", async () => {
  await expect(exportNotebookCnf(other, notebookId)).rejects.toThrow("不存在");
  fs.rmSync(path.join(directory, `data/uploads/notes/${assetId}.png`));
  await expect(exportNotebookCnf(owner, notebookId)).rejects.toThrow("图片缺失");
});

it("rolls back DB rows and newly created files when an import fails after copying assets", async () => {
  const exported = await exportNotebookCnf(owner, notebookId);
  const uploadDirectory = path.join(directory, "data/uploads/notes");
  const files = fs.readdirSync(uploadDirectory);
  state.sqlite.exec("CREATE TRIGGER reject_import BEFORE INSERT ON pages BEGIN SELECT RAISE(ABORT,'injected import failure'); END");
  await expect(importNotebookCnf(other, exported.bytes)).rejects.toThrow("injected import failure");
  expect(state.sqlite.prepare("SELECT count(*) AS n FROM notebooks WHERE user_id=?").get(other)).toEqual({ n: 0 });
  expect(state.sqlite.prepare("SELECT count(*) AS n FROM assets WHERE user_id=?").get(other)).toEqual({ n: 0 });
  expect(fs.readdirSync(uploadDirectory)).toEqual(files);
});

it("validates checksums, unsupported versions/nodes/attributes, duplicate pages and dangling references before any write", async () => {
  const exported = await exportNotebookCnf(owner, notebookId);
  const archive = await parseCnf(exported.bytes);
  const mutate = async (change: (notebook: typeof archive.notebook, manifest: typeof archive.manifest) => void, rehash = true) => {
    const notebook = structuredClone(archive.notebook), manifest = structuredClone(archive.manifest);
    change(notebook, manifest);
    const entries = new Map(archive.entries);
    const data = Buffer.from(JSON.stringify(notebook));
    entries.set("notebook.json", data);
    if (rehash) manifest.notebookSha256 = sha256(data);
    entries.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
    return createCnfZip(entries);
  };
  await expect(importNotebookCnf(other, await mutate((notebook) => { notebook.title = "篡改"; }, false))).rejects.toThrow("校验");
  await expect(importNotebookCnf(other, await mutate((_notebook, manifest) => { Object.assign(manifest, { formatVersion: 999 }); }))).rejects.toThrow("版本");
  await expect(importNotebookCnf(other, await mutate((notebook) => { notebook.pages[0].content = { type: "doc", content: [{ type: "unknownWidget" }] }; }))).rejects.toThrow("不支持节点");
  await expect(importNotebookCnf(other, await mutate((notebook) => { notebook.pages[0].content = { type: "doc", content: [{ type: "paragraph", attrs: { customUnknown: "preserve me" } }] }; }))).rejects.toThrow("不支持 paragraph 属性");
  await expect(importNotebookCnf(other, await mutate((notebook) => { notebook.pages.push(notebook.pages[0]); }))).rejects.toThrow();
  await expect(importNotebookCnf(other, await mutate((notebook) => { notebook.coverAssetId = randomUUID(); }))).rejects.toThrow("封面引用");
  const entries = new Map(archive.entries); entries.set(archive.manifest.assets[0].path, Buffer.from("corrupted"));
  await expect(importNotebookCnf(other, await createCnfZip(entries))).rejects.toThrow("图片损坏");
  await expect(importNotebookCnf(other, Buffer.from("not a ZIP"))).rejects.toThrow("压缩结构");
  expect(state.sqlite.prepare("SELECT count(*) AS n FROM notebooks WHERE user_id=?").get(other)).toEqual({ n: 0 });
});

it("CNF2 page/notebook scopes pack only directly referenced entries and remap labels and unresolved targets without exporting retired tags", async () => {
  const { createEntry, getEntry, updateEntry, checkReferences } = await import("@/lib/knowledge");
  const { exportPageCnf } = await import("@/lib/cnf");
  const a = createEntry(owner, { title: "操作系统", aliases: ["OS"] }), b = createEntry(owner, { title: "虚拟内存", aliases: [] });
  const reference = (id: string, label: string) => ({ type: "knowledgeReference", attrs: { entryId: id, label, referenceType: "entry" } });
  updateEntry(owner, a.id, { version: a.version, content: { type: "doc", content: [{ type: "paragraph", content: [reference(b.id, b.title)] }, { type: "image", attrs: { assetId, src: `/uploads/notes/${assetId}` } }] } });
  const content = { type: "doc", content: [{ type: "paragraph", content: [reference(a.id, a.title), reference(a.id, a.title)] }] };
  state.sqlite.prepare("UPDATE pages SET content=? WHERE id=?").run(JSON.stringify(content), firstPage);
  const legacyTag = randomUUID();
  state.sqlite.prepare("INSERT INTO tags (id,user_id,name,normalized_name,created_at,updated_at) VALUES (?,?,'旧标签','旧标签',?,?)").run(legacyTag,owner,now,now);
  state.sqlite.prepare("INSERT INTO content_tags (tag_id,source_type,source_id) VALUES (?,'page',?)").run(legacyTag,firstPage);
  const archive = await parseCnf((await exportPageCnf(owner, firstPage)).bytes);
  expect(archive.manifest.formatVersion).toBe(2); expect(archive.manifest.scope).toBe("page"); expect(archive.notebook.pages).toHaveLength(1);
  expect(archive.knowledge.entries.map((item) => item.id)).toEqual([a.id]); expect(archive.manifest.assets).toHaveLength(1);
  const imported = await importNotebookCnf(other, (await exportPageCnf(owner, firstPage)).bytes);
  const next = await parseCnf((await exportNotebookCnf(other, imported.id)).bytes);
  expect(next.knowledge.entries).toHaveLength(1); expect(next.knowledge.entries[0].id).not.toBe(a.id); expect(next.knowledge.entries[0].aliases).toEqual(["OS"]);
  expect(next.knowledge.pageTags).toEqual([]); expect(next.knowledge.tags).toEqual([]); expect(state.sqlite.prepare("SELECT id FROM tags WHERE id=?").get(legacyTag)).toEqual({ id: legacyTag });
  const unresolved = checkReferences(other); expect(unresolved.statistics.validReferences).toBe(2); expect(unresolved.statistics.invalidReferences).toBe(1);
  expect(unresolved.issues[0].entryId).toBe(b.id);
  // Imported unresolved references remain editable, without granting access to the original owner.
  const importedEntry = next.knowledge.entries[0]; expect(() => updateEntry(other, importedEntry.id, { version: 1, content: getEntry(other, importedEntry.id).content })).not.toThrow();
});

it("independent knowledge export includes unreferenced entries and restores cycles without recursive packing", async () => {
  const { createEntry, getEntry, updateEntry, listEntries, checkReferences } = await import("@/lib/knowledge"); const { exportKnowledgeCnf } = await import("@/lib/cnf");
  const a = createEntry(owner, { title: "A", aliases: ["AA"] }), b = createEntry(owner, { title: "B", aliases: [] }); createEntry(owner, { title: "没有被引用的知识", aliases: [] });
  const document = (id: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "knowledgeReference", attrs: { entryId: id, label: "原名称", referenceType: "entry" } }] }] });
  updateEntry(owner, a.id, { version: 1, content: document(b.id) }); updateEntry(owner, b.id, { version: 1, content: document(a.id) });
  const exported = await exportKnowledgeCnf(owner), parsed = await parseCnf(exported.bytes); expect(parsed.manifest.scope).toBe("knowledge"); expect(parsed.knowledge.entries).toHaveLength(3);
  const before = state.sqlite.prepare("SELECT COUNT(*) AS n FROM notebooks WHERE user_id=?").get(other);
  const result = await importNotebookCnf(other, exported.bytes); expect(result.kind).toBe("knowledge"); expect(listEntries(other)).toHaveLength(3); expect(checkReferences(other).statistics).toEqual({ entries: 3, validReferences: 2, invalidReferences: 0, unreferencedEntries: 1 });
  expect(state.sqlite.prepare("SELECT COUNT(*) AS n FROM notebooks WHERE user_id=?").get(other)).toEqual(before);
  await expect(importNotebookCnf(other, exported.bytes)).rejects.toThrow("冲突"); expect(listEntries(other)).toHaveLength(3);
  const reused = await importNotebookCnf(other, exported.bytes, true); expect(reused.reusedEntries).toBe(3); expect(listEntries(other)).toHaveLength(3);
  const renamed = await importNotebookCnf(other, exported.bytes, "rename"); expect(renamed.renamedEntries).toBe(3); expect(listEntries(other)).toHaveLength(6);
  const newA = listEntries(other).find((item) => item.title === "A（导入 1）")!, newB = listEntries(other).find((item) => item.title === "B（导入 1）")!;
  expect(getEntry(other,newA.id).content).toContain(newB.id); expect(getEntry(other,newB.id).content).toContain(newA.id);
  expect(newA.aliases).toEqual(["AA（导入 1）"]);

});

it("rejects corrupt knowledge data and atomically rolls back entry failures and written resource files", async () => {
  const { createEntry } = await import("@/lib/knowledge"); const { exportKnowledgeCnf } = await import("@/lib/cnf");
  createEntry(owner, { title: "带图片词条", aliases: [], content: nativeDocument(assetId) }); const bytes = (await exportKnowledgeCnf(owner)).bytes;
  const archive = await parseCnf(bytes), entries = new Map(archive.entries); entries.set("knowledge.json", Buffer.from("{}"));
  await expect(importNotebookCnf(other, await createCnfZip(entries))).rejects.toThrow();
  const files = fs.readdirSync(path.join(directory, "data/uploads/notes"));
  state.sqlite.exec(`CREATE TRIGGER fail_knowledge BEFORE INSERT ON knowledge_entries WHEN NEW.user_id='${other}' BEGIN SELECT RAISE(ABORT, 'synthetic knowledge failure'); END;`);
  await expect(importNotebookCnf(other, bytes)).rejects.toThrow("synthetic knowledge failure");
  expect(fs.readdirSync(path.join(directory, "data/uploads/notes"))).toEqual(files); expect(state.sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_entries WHERE user_id=?").get(other)).toEqual({ n: 0 });
});
