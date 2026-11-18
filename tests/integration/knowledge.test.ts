import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ sqlite: undefined as unknown as Database.Database }));
vi.mock("@/db", () => ({ get sqlite() { return state.sqlite; } }));
import { createEntry, getEntry, listEntries, updateEntry, deleteEntry, backlinks, checkReferences, repairReference, validateKnowledgeContent } from "@/lib/knowledge";
import { applyTagAction, listTags } from "@/lib/tags";
let owner: string, other: string, notebook: string;
const now = "2026-11-18T00:00:00.000Z";
const textDoc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const ref = (id: string, label = "引用") => ({ type: "knowledgeReference", attrs: { entryId: id, label, referenceType: "entry" } });
const refDoc = (...ids: string[]) => ({ type: "doc", content: [{ type: "paragraph", content: ids.map((id) => ref(id)) }] });
function entry(title: string, aliases: string[] = []) { return createEntry(owner, { title, aliases }); }
function page(content: unknown) { const id = randomUUID(); state.sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,title,content,created_at,updated_at) VALUES (?,?,?,'来源页面',?,?,?)").run(id, owner, notebook, JSON.stringify(content), now, now); return id; }
beforeEach(() => {
  state.sqlite = new Database(":memory:"); state.sqlite.pragma("foreign_keys=ON"); migrate(drizzle(state.sqlite), { migrationsFolder: "drizzle" });
  owner = randomUUID(); other = randomUUID(); notebook = randomUUID();
  for (const id of [owner, other]) { state.sqlite.prepare("INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,'unused','USER',?)").run(id, id, now); const folder = randomUUID(); state.sqlite.prepare("INSERT INTO folders (id,user_id,name,is_default,created_at,updated_at) VALUES (?,?,'默认',1,?,?)").run(folder, id, now, now); if (id === owner) state.sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,created_at,updated_at) VALUES (?,?,?,'原有笔记本',?,?)").run(notebook, owner, folder, now, now); }
});
afterEach(() => state.sqlite.close());
it("creates empty/long entries, deduplicates aliases and atomically rejects a shared name namespace conflict", () => {
  const first = entry("操作系统", ["OS", " Operating System ", "os", "操作系统"]);
  expect(JSON.parse(first.content).type).toBe("doc"); expect(first.aliases).toEqual(["Operating System", "OS"]);
  expect(() => entry("ＯＳ")).toThrow("已被"); expect(() => entry("另一个词条", ["Operating System"])).toThrow("已被");
  expect(listEntries(owner)).toHaveLength(1); expect(listEntries(other)).toHaveLength(0);
  const long = updateEntry(owner, first.id, { version: first.version, content: textDoc("长正文".repeat(20_000) + "末尾检索") });
  expect(listEntries(owner, "末尾检索")[0].id).toBe(first.id); expect(listEntries(owner, "operating system")[0].id).toBe(first.id); expect(long.content.length).toBeGreaterThan(50_000);
});
it("uses versions, preserves content on rename and isolates owners/assets", () => {
  const first = entry("旧名称"); const changed = updateEntry(owner, first.id, { version: 1, title: "新名称", content: textDoc("定义") });
  expect(changed.id).toBe(first.id); expect(() => updateEntry(owner, first.id, { version: 1, title: "过期写入" })).toThrow("版本冲突");
  expect(updateEntry(owner, first.id, { version: changed.version, content: changed.content, aliases: [] }).version).toBe(changed.version);
  expect(() => createEntry(owner, { title: "不支持的内容", aliases: [], content: { type: "doc", content: [{ type: "unknownNode" }] } })).toThrow("不支持");
  expect(() => getEntry(other, first.id)).toThrow("不存在");
  const asset = randomUUID(); state.sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?,?,?,'image/png','test',1,?)").run(asset, other, asset+'.png', now);
  expect(() => updateEntry(owner, first.id, { version: changed.version, content: { type: "doc", content: [{ type: "image", attrs: { src: `/uploads/notes/${asset}`, assetId: asset } }] } })).toThrow("无权");
});
it("derives deduplicated backlinks, allows cycles and excludes deleted page/notebook sources", () => {
  const a = entry("A"), b = entry("B"); const source = page(refDoc(a.id, a.id));
  updateEntry(owner, a.id, { version: 1, content: refDoc(b.id) }); updateEntry(owner, b.id, { version: 1, content: refDoc(a.id) });
  expect(backlinks(owner, a.id)).toHaveLength(2); expect(checkReferences(owner).statistics.validReferences).toBe(4);
  expect(() => updateEntry(owner, a.id, { version: 2, content: refDoc(a.id) })).toThrow("自身");
  state.sqlite.prepare("UPDATE notebooks SET deleted_at=? WHERE id=?").run(now, notebook);
  expect(backlinks(owner, a.id).map((item) => item.id)).not.toContain(source);
  deleteEntry(owner, b.id); const report = checkReferences(owner); expect(report.statistics.invalidReferences).toBe(1); expect(report.statistics.entries).toBe(1);
});
it("repairs only one exact occurrence and rolls back a newly created target on a stale path", () => {
  const a = entry("目标"); const source = page(refDoc(a.id, a.id)); deleteEntry(owner, a.id);
  const issue = checkReferences(owner).issues[0]; expect(checkReferences(owner).statistics.invalidReferences).toBe(2);
  repairReference(owner, { ...pick(issue), asText: true });
  let content = JSON.parse((state.sqlite.prepare("SELECT content FROM pages WHERE id=?").get(source) as { content: string }).content);
  expect(content.content[0].content[0]).toEqual({ type: "text", text: "@引用" }); expect(content.content[0].content[1].type).toBe("knowledgeReference");
  expect(() => repairReference(owner, { ...pick(issue), createTitle: "过期目标" })).toThrow("重新检查"); expect(listEntries(owner, "过期目标")).toHaveLength(0);
  const remaining = checkReferences(owner).issues[0];
  expect(() => repairReference(owner, { ...pick(remaining), path: [0, 99], createTitle: "错误路径目标" })).toThrow("引用位置"); expect(listEntries(owner, "错误路径目标")).toHaveLength(0);
  repairReference(owner, { ...pick(remaining), createTitle: "恢复的目标" }); expect(checkReferences(owner).statistics.invalidReferences).toBe(0);
  content = JSON.parse((state.sqlite.prepare("SELECT content FROM pages WHERE id=?").get(source) as { content: string }).content); expect(content.content[0].content[1].attrs.entryId).toBe(listEntries(owner, "恢复的目标")[0].id);
  expect(state.sqlite.prepare("SELECT COUNT(*) AS n FROM note_snapshots WHERE page_id=?").get(source)).toEqual({ n: 2 });
});
function pick(issue: ReturnType<typeof checkReferences>["issues"][number]) { return { sourceType: issue.sourceType, sourceId: issue.sourceId, path: issue.path, version: issue.version, entryId: issue.entryId, label: issue.label }; }
it("relinks to an owned entry, reports malformed metadata, and keeps unreferenced knowledge", () => {
  const a = entry("未引用词条"), b = entry("修复目标"); page({ type: "doc", content: [{ type: "paragraph", content: [{ type: "knowledgeReference", attrs: { label: "缺失ID" } }] }] });
  let report = checkReferences(owner); expect(report.statistics.unreferencedEntries).toBe(2); expect(report.issues[0].reason).toContain("元数据");
  repairReference(owner, { ...pick(report.issues[0]), targetId: b.id }); report = checkReferences(owner); expect(report.statistics.validReferences).toBe(1); expect(report.statistics.unreferencedEntries).toBe(1); expect(getEntry(owner, a.id)).toBeDefined();
  const foreign = createEntry(other, { title: "私有词条", aliases: [] }); expect(() => validateKnowledgeContent(owner, refDoc(foreign.id))).toThrow("不可访问");
});
it("shares tags across pages/entries and merges/deletes only relationships with owner checks", () => {
  const first = entry("标签词条"), source = page(textDoc("标签页面"));
  applyTagAction(owner, { action: "create", name: "学习" }); applyTagAction(owner, { action: "create", name: "工作" });
  const [a,b] = listTags(owner); expect(() => applyTagAction(owner, { action: "create", name: a.name })).toThrow("已存在");
  applyTagAction(owner, { action: "assign", sourceType: "entry", sourceId: first.id, tagIds: [a.id] }); applyTagAction(owner, { action: "assign", sourceType: "page", sourceId: source, tagIds: [a.id,b.id] });
  expect(() => applyTagAction(other, { action: "assign", sourceType: "page", sourceId: source, tagIds: [a.id] })).toThrow("不存在");
  applyTagAction(owner, { action: "rename", id: a.id, name: "共享标签" }); expect(getEntry(owner, first.id).tags[0].name).toBe("共享标签");
  applyTagAction(owner, { action: "merge", id: a.id, targetId: b.id }); expect(getEntry(owner, first.id).tags.map((tag) => tag.id)).toEqual([b.id]); expect(listEntries(owner, "", b.id)).toHaveLength(1);
  applyTagAction(owner, { action: "delete", id: b.id }); expect(getEntry(owner, first.id).tags).toHaveLength(0); expect(state.sqlite.prepare("SELECT id FROM pages WHERE id=?").get(source)).toBeTruthy();
});
