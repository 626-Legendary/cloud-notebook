import { validateEditableDocument } from "@/lib/cnf-format";
import { sqlite } from "@/db";
import { z } from "zod";
import { collectDocumentAssetIds } from "@/lib/asset-references";
import { extractSearchableText } from "@/lib/search-text";
import { documentReferences, emptyKnowledgeDocument, normalizeKnowledgeName, replaceReferenceAtPath, resolveKnowledgeLabels } from "@/lib/knowledge-document";

export class KnowledgeError extends Error {
  constructor(message: string, public status = 400, public details?: Record<string, unknown>) { super(message); }
}
export type EntryRow = { id: string; title: string; content: string; version: number; createdAt: string; updatedAt: string };
const entryColumns = "id,title,content,version,created_at AS createdAt,updated_at AS updatedAt";
const nameSchema = z.string().trim().min(1).max(120).refine((value) => Boolean(normalizeKnowledgeName(value)), "名称不能为空");
export const entryCreateSchema = z.object({ title: nameSchema, aliases: z.array(nameSchema).max(50).default([]), content: z.record(z.unknown()).optional() }).strict();
export const entryUpdateSchema = z.object({ title: nameSchema.optional(), aliases: z.array(nameSchema).max(50).optional(), content: z.union([z.string().max(2_000_000), z.record(z.unknown())]).optional(), version: z.number().int().positive(), preserveCurrentVersion: z.boolean().optional() }).strict();

export function ownSource(userId: string, kind: "page" | "entry", id: string): EntryRow {
  const query = kind === "entry"
    ? `SELECT ${entryColumns} FROM knowledge_entries WHERE id=? AND user_id=? AND deleted_at IS NULL`
    : `SELECT ${entryColumns} FROM pages WHERE id=? AND user_id=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM notebooks n WHERE n.id=pages.notebook_id AND n.user_id=pages.user_id AND n.deleted_at IS NULL)`;
  const row = sqlite.prepare(query).get(id, userId) as EntryRow | undefined;
  if (!row) throw new KnowledgeError(kind === "entry" ? "词条不存在或已删除" : "页面不存在", 404);
  return row;
}
export function entryAliases(userId: string, id: string) {
  return (sqlite.prepare("SELECT name FROM knowledge_names WHERE user_id=? AND entry_id=? AND kind='alias' ORDER BY normalized_name").all(userId, id) as { name: string }[]).map((row) => row.name);
}
export function getEntry(userId: string, id: string) {
  const row = ownSource(userId, "entry", id);
  return { ...row, summary: extractSearchableText(row.content).slice(0, 200), aliases: entryAliases(userId, id) };
}
export function listEntries(userId: string, query = "", sort = "updated", catalogOnly = false) {
  const rows = sqlite.prepare(`SELECT ${catalogOnly ? "id,title,version,created_at AS createdAt,updated_at AS updatedAt" : entryColumns} FROM knowledge_entries WHERE user_id=? AND deleted_at IS NULL`).iterate(userId) as IterableIterator<EntryRow>;
  const names = sqlite.prepare("SELECT entry_id AS entryId,name FROM knowledge_names WHERE user_id=? AND kind='alias'").all(userId) as { entryId: string; name: string }[];
  const aliasMap = new Map<string, string[]>();
  for (const name of names) { const items = aliasMap.get(name.entryId) ?? []; items.push(name.name); aliasMap.set(name.entryId, items); }
  const titles = new Map((sqlite.prepare("SELECT id,title FROM knowledge_entries WHERE user_id=? AND deleted_at IS NULL").all(userId) as { id: string; title: string }[]).map((entry) => [entry.id, entry.title]));
  const normalizedQuery = normalizeKnowledgeName(query);
  const result = [];
  for (const row of rows) {
    const aliases = aliasMap.get(row.id) ?? [];
    let summary = "";
    if (!catalogOnly) { try { summary = extractSearchableText(JSON.stringify(resolveKnowledgeLabels(JSON.parse(row.content), titles))); } catch { summary = "正文格式异常"; } }
    if (normalizedQuery && !normalizeKnowledgeName([row.title, ...aliases, summary].join(" ")).includes(normalizedQuery)) continue;
    result.push({ id: row.id, title: row.title, aliases, summary: summary.slice(0, 200), createdAt: row.createdAt, updatedAt: row.updatedAt });
  }
  return result.sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
}

export function validateKnowledgeContent(userId: string, value: unknown, selfId?: string, previous?: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (selfId && Buffer.byteLength(text) > 2_000_000) throw new KnowledgeError("正文不能超过 2 MB");
  let document: unknown;
  try { document = JSON.parse(text); } catch { throw new KnowledgeError("正文 JSON 无效"); }
  if (!document || typeof document !== "object" || (document as { type?: unknown }).type !== "doc") throw new KnowledgeError("正文格式无效");
  let refs, previousRefs;
  try {
    refs = documentReferences(document); previousRefs = previous ? documentReferences(previous) : [];
    if (selfId) validateEditableDocument(document as Record<string, unknown>, false);
  } catch (error) { throw new KnowledgeError(error instanceof Error ? error.message : "正文结构无效"); }
  // Existing unresolved references survive editing/deletion/import. Never authorize by a supplied owner ID.
  for (const ref of refs) {
    if (!ref.valid) throw new KnowledgeError("引用元数据无效");
    const existed = previousRefs.some((item) => item.entryId === ref.entryId);
    if (selfId && ref.entryId === selfId && !existed) throw new KnowledgeError("不能创建指向当前词条自身的引用");
    const target = sqlite.prepare("SELECT user_id AS userId FROM knowledge_entries WHERE id=?").get(ref.entryId) as { userId: string } | undefined;
    if (target && target.userId !== userId && !existed) throw new KnowledgeError("引用目标不可访问", 403);
  }
  const resources = collectDocumentAssetIds([text]);
  if (resources.ambiguous) throw new KnowledgeError("正文图片引用无效");
  for (const id of resources.ids) if (!sqlite.prepare("SELECT id FROM assets WHERE id=? AND user_id=?").get(id, userId)) throw new KnowledgeError("正文引用了无权访问的图片", 403);
  return text;
}
export function replaceEntryNames(userId: string, entryId: string, title: string, aliases: string[]) {
  const names = new Map<string, { name: string; kind: "title" | "alias" }>();
  names.set(normalizeKnowledgeName(title), { name: title.trim(), kind: "title" });
  for (const alias of aliases) if (!names.has(normalizeKnowledgeName(alias))) names.set(normalizeKnowledgeName(alias), { name: alias.trim(), kind: "alias" });
  for (const key of names.keys()) {
    const existing = sqlite.prepare("SELECT entry_id AS id FROM knowledge_names WHERE user_id=? AND normalized_name=? AND entry_id<>?").get(userId, key, entryId) as { id: string } | undefined;
    if (existing) throw new KnowledgeError("正式名称或别名已被其他词条使用", 409, { existingId: existing.id });
  }
  sqlite.prepare("DELETE FROM knowledge_names WHERE user_id=? AND entry_id=?").run(userId, entryId);
  for (const [key, value] of names) sqlite.prepare("INSERT INTO knowledge_names (user_id,normalized_name,entry_id,name,kind) VALUES (?,?,?,?,?)").run(userId, key, entryId, value.name, value.kind);
}
export function createEntry(userId: string, input: z.infer<typeof entryCreateSchema>) {
  return sqlite.transaction(() => {
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const content = validateKnowledgeContent(userId, input.content ?? emptyKnowledgeDocument, id);
    sqlite.prepare("INSERT INTO knowledge_entries (id,user_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, userId, input.title.trim(), content, now, now);
    replaceEntryNames(userId, id, input.title, input.aliases);
    return getEntry(userId, id);
  }).immediate();
}
export function updateEntry(userId: string, id: string, input: z.infer<typeof entryUpdateSchema>) {
  return sqlite.transaction(() => {
    const current = getEntry(userId, id);
    if (current.version !== input.version) throw new KnowledgeError("词条已在其他位置更新，请先处理版本冲突", 409, { currentVersion: current.version });
    const title = input.title ?? current.title;
    const content = input.content === undefined ? current.content : validateKnowledgeContent(userId, input.content, id, JSON.parse(current.content));
    if (input.aliases !== undefined || title !== current.title) replaceEntryNames(userId, id, title, input.aliases ?? current.aliases);
    if (title !== current.title || content !== current.content || JSON.stringify(entryAliases(userId, id)) !== JSON.stringify(current.aliases)) sqlite.prepare("UPDATE knowledge_entries SET title=?,content=?,version=version+1,updated_at=? WHERE id=? AND user_id=?").run(title, content, new Date().toISOString(), id, userId);
    return getEntry(userId, id);
  }).immediate();
}
export function deleteEntry(userId: string, id: string) {
  sqlite.transaction(() => {
    ownSource(userId, "entry", id);
    sqlite.prepare("UPDATE knowledge_entries SET deleted_at=?,version=version+1 WHERE id=? AND user_id=?").run(new Date().toISOString(), id, userId);
    sqlite.prepare("DELETE FROM knowledge_names WHERE entry_id=? AND user_id=?").run(id, userId);
  }).immediate();
}
export function* allReferenceSources(userId: string) {
  const pages = sqlite.prepare(`SELECT p.id,p.title,p.content,p.version,p.notebook_id AS notebookId,n.title AS notebookTitle FROM pages p JOIN notebooks n ON n.id=p.notebook_id AND n.user_id=p.user_id WHERE p.user_id=? AND p.deleted_at IS NULL AND n.deleted_at IS NULL`).iterate(userId) as IterableIterator<{ id: string; title: string; content: string; version: number; notebookId: string; notebookTitle: string }>;
  for (const row of pages) yield { ...row, type: "page" as const };
  const entries = sqlite.prepare(`SELECT ${entryColumns} FROM knowledge_entries WHERE user_id=? AND deleted_at IS NULL`).iterate(userId) as IterableIterator<EntryRow>;
  for (const row of entries) yield { ...row, type: "entry" as const, notebookId: "", notebookTitle: "" };
}
export function backlinks(userId: string, targetId: string) {
  const result = [];
  for (const row of allReferenceSources(userId)) {
    try { if (!documentReferences(JSON.parse(row.content)).some((ref) => ref.entryId === targetId)) continue; } catch { continue; }
    result.push({ id: row.id, title: row.title, type: row.type, notebookId: row.notebookId, notebookTitle: row.notebookTitle, version: row.version });
  }
  return result;
}
export function checkReferences(userId: string) {
  return sqlite.transaction(() => {
    const entries = listEntries(userId, "", "updated", true), ids = new Set(entries.map((entry) => entry.id)), used = new Set<string>();
    const issues: { sourceType: "page" | "entry"; sourceId: string; title: string; notebookId: string; path: number[]; entryId: string; label: string; version: number; reason: string }[] = [];
    let validReferences = 0, invalidReferences = 0;
    for (const source of allReferenceSources(userId)) {
      let refs;
      try { refs = documentReferences(JSON.parse(source.content)); } catch { issues.push({ sourceType: source.type, sourceId: source.id, title: source.title, notebookId: source.notebookId, path: [], entryId: "", label: "", version: source.version, reason: "正文格式无效，无法检查" }); continue; }
      for (const ref of refs) {
        if (ref.valid && ids.has(ref.entryId)) { validReferences++; used.add(ref.entryId); }
        else { invalidReferences++; issues.push({ sourceType: source.type, sourceId: source.id, title: source.title, notebookId: source.notebookId, ...ref, version: source.version, reason: ref.valid ? "目标词条不存在或已删除" : "引用元数据不完整" }); }
      }
    }
    const nameIssues: string[] = [];
    const names = new Map<string, string>();
    for (const entry of entries) for (const name of [entry.title, ...entry.aliases]) {
      const key = normalizeKnowledgeName(name); if (names.has(key) && names.get(key) !== entry.id) nameIssues.push(name); names.set(key, entry.id);
    }
    return { statistics: { entries: entries.length, validReferences, invalidReferences, unreferencedEntries: entries.filter((entry) => !used.has(entry.id)).length }, issues, nameConflicts: nameIssues, index: "derived" as const };
  })();
}
export const repairReferenceSchema = z.object({ sourceType: z.enum(["page", "entry"]), sourceId: z.string().uuid(), version: z.number().int().positive(), path: z.array(z.number().int().nonnegative()).min(1).max(80), entryId: z.string().max(200), label: z.string().max(200), targetId: z.string().uuid().optional(), createTitle: nameSchema.optional(), asText: z.boolean().optional() }).strict().refine((value) => Number(Boolean(value.targetId)) + Number(Boolean(value.createTitle)) + Number(Boolean(value.asText)) === 1);
export function repairReference(userId: string, input: z.infer<typeof repairReferenceSchema>) {
  return sqlite.transaction(() => {
    const source = ownSource(userId, input.sourceType, input.sourceId);
    if (source.version !== input.version) throw new KnowledgeError("正文已改变，请保存编辑并重新检查", 409, { currentVersion: source.version });
    const target = input.targetId ? getEntry(userId, input.targetId) : input.createTitle ? createEntry(userId, { title: input.createTitle, aliases: [] }) : null;
    if (target && input.sourceType === "entry" && target.id === input.sourceId) throw new KnowledgeError("不能创建指向当前词条自身的引用");
    let document: unknown;
    try { document = replaceReferenceAtPath(JSON.parse(source.content), input.path, input, target ? { entryId: target.id, label: target.title } : null); } catch (error) { throw new KnowledgeError(error instanceof Error ? error.message : "引用位置无效", 409); }
    const content = JSON.stringify(document), now = new Date().toISOString();
    if (input.sourceType === "page") sqlite.prepare("INSERT INTO note_snapshots (id,user_id,page_id,title,content,created_at) VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(), userId, source.id, source.title, source.content, now);
    sqlite.prepare(`UPDATE ${input.sourceType === "page" ? "pages" : "knowledge_entries"} SET content=?,version=version+1,updated_at=? WHERE id=? AND user_id=?`).run(content, now, source.id, userId);
    return { sourceId: source.id, version: source.version + 1 };
  }).immediate();
}

export function resolveKnowledgeContent(userId: string, raw: string) {
  const rows = sqlite.prepare("SELECT id,title FROM knowledge_entries WHERE user_id=? AND deleted_at IS NULL").all(userId) as { id: string; title: string }[];
  try { return JSON.stringify(resolveKnowledgeLabels(JSON.parse(raw), new Map(rows.map((row) => [row.id, row.title])))); } catch { return raw; }
}
