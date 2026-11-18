import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, nowIso, sqlite } from "@/db";
import { folders, users } from "@/db/schema";
import { detectImage, extensionForMime } from "@/lib/images";
import { readZipEntries } from "@/lib/zip-reader";
import { cnfKnowledgeSchema, validateEditableDocument } from "@/lib/cnf-format";
import { mapKnowledgeReferences, normalizeKnowledgeName } from "@/lib/knowledge-document";
import { replaceEntryNames } from "@/lib/knowledge";
import { safeFileName } from "@/lib/filename";

const uuid = z.string().uuid();
const folderSchema = z.array(z.object({
  id: uuid, name: z.string().min(1).max(80), isDefault: z.boolean(), sortOrder: z.number().int()
})).max(500);
const notebookSchema = z.array(z.object({
  id: uuid, folderId: uuid, title: z.string().min(1).max(120), coverAssetId: uuid.nullable().optional(), sortOrder: z.number().int()
})).max(2_000);
const pageSchema = z.array(z.object({
  id: uuid, notebookId: uuid, title: z.string().min(1).max(200), content: z.string().max(2_000_000),
  sortOrder: z.number().int(), createdAt: z.string(), updatedAt: z.string()
})).max(10_000);
const snapshotSchema = z.array(z.object({
  id: uuid, pageId: uuid, title: z.string().min(1).max(200), content: z.string().max(2_000_000), createdAt: z.string()
})).max(50_000);
const assetSchema = z.array(z.object({
  id: uuid, mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  originalName: z.string().max(200), size: z.number().int().positive().max(10 * 1024 * 1024), createdAt: z.string()
})).max(20_000);

export async function restoreUserArchive(targetUserId: string, compressed: Buffer) {
  if (compressed.length > 100 * 1024 * 1024) throw new Error("备份文件不能超过 100 MB");
  const entries = await readZipEntries(compressed, 200 * 1024 * 1024, 200 * 1024 * 1024);
  const json = (name: string) => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`备份缺少 ${name}`);
    return JSON.parse(entry.toString("utf8")) as unknown;
  };
  const manifest = z.object({
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    knowledgeCount: z.number().int().nonnegative().optional(), tagCount: z.number().int().nonnegative().optional(),
    folderCount: z.number().int().nonnegative(),
    notebookCount: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    snapshotCount: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative()
  }).safeParse(json("manifest.json"));
  if (!manifest.success) throw new Error("备份清单格式不受支持");
  const importedFolders = folderSchema.parse(json("folders.json"));
  const importedNotebooks = notebookSchema.parse(json("notebooks.json"));
  const importedPages = pageSchema.parse(json("pages.json"));
  const importedSnapshots = snapshotSchema.parse(json("snapshots.json"));
  const importedAssets = assetSchema.parse(json("assets.json"));
  const knowledge = manifest.data.formatVersion === 2 ? cnfKnowledgeSchema.parse(json("knowledge.json")) : { entries: [], tags: [], pageTags: [] };
  if (manifest.data.formatVersion === 2 && (manifest.data.knowledgeCount !== knowledge.entries.length || manifest.data.tagCount !== knowledge.tags.length)) throw new Error("知识库备份清单与数据不一致");
  const entryIds = new Map<string, string>(), tagIds = new Map<string, string>();
  const names = new Set<string>(), tagNames = new Set<string>(), pageIdSet = new Set(importedPages.map((page) => page.id));
  for (const entry of knowledge.entries) {
    if (entryIds.has(entry.id)) throw new Error("备份中的词条 ID 重复"); entryIds.set(entry.id, crypto.randomUUID()); validateEditableDocument(entry.content, false);
    for (const name of [entry.title,...entry.aliases]) { const normalized=normalizeKnowledgeName(name); if (!normalized || names.has(normalized)) throw new Error("备份中词条名称或别名冲突"); names.add(normalized); }
  }
  for (const tag of knowledge.tags) { const normalized=normalizeKnowledgeName(tag.name); if (!normalized || tagIds.has(tag.id) || tagNames.has(normalized)) throw new Error("备份标签名称或标识重复"); tagNames.add(normalized); tagIds.set(tag.id, crypto.randomUUID()); }
  for (const item of [...knowledge.entries,...knowledge.pageTags]) if (item.tagIds.some((id) => !tagIds.has(id))) throw new Error("备份标签关联不存在");
  for (const item of knowledge.pageTags) if (!pageIdSet.has(item.pageId)) throw new Error("备份标签页面不存在");

  if (
    manifest.data.folderCount !== importedFolders.length ||
    manifest.data.notebookCount !== importedNotebooks.length ||
    manifest.data.pageCount !== importedPages.length ||
    manifest.data.snapshotCount !== importedSnapshots.length ||
    manifest.data.assetCount !== importedAssets.length
  ) throw new Error("备份清单与数据内容不一致");
  const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, targetUserId), eq(users.role, "USER"))).limit(1);
  if (!target) throw new Error("目标用户不存在");
  const [defaultFolder] = await db.select().from(folders).where(and(eq(folders.userId, targetUserId), eq(folders.isDefault, true))).limit(1);
  if (!defaultFolder) throw new Error("目标用户缺少默认文件夹");

  const folderIds = new Map<string, string>();
  const notebookIds = new Map<string, string>();
  const pageIds = new Map<string, string>();
  const assetIds = new Map<string, string>();
  const createdFiles: string[] = [];
  const uploadDirectory = path.resolve(process.cwd(), "data/uploads/notes");
  await fs.mkdir(uploadDirectory, { recursive: true });

  for (const folder of importedFolders) folderIds.set(folder.id, folder.isDefault ? defaultFolder.id : crypto.randomUUID());
  for (const notebook of importedNotebooks) {
    if (!folderIds.has(notebook.folderId)) throw new Error("备份中的笔记本文件夹引用无效");
    notebookIds.set(notebook.id, crypto.randomUUID());
  }
  for (const page of importedPages) {
    if (!notebookIds.has(page.notebookId)) throw new Error("备份中的页面笔记本引用无效");
    pageIds.set(page.id, crypto.randomUUID());
  }
  for (const asset of importedAssets) assetIds.set(asset.id, crypto.randomUUID());
  for (const notebook of importedNotebooks) {
    if (notebook.coverAssetId && !assetIds.has(notebook.coverAssetId)) throw new Error("备份中的封面图片引用无效");
  }

  const assetRows: { id: string; oldId: string; mimeType: string; originalName: string; storagePath: string; size: number }[] = [];
  try {
    for (const asset of importedAssets) {
      const extension = extensionForMime(asset.mimeType);
      if (!extension) throw new Error("备份中包含不支持的图片类型");
      const bytes = entries.get(`assets/${asset.id}.${extension}`);
      if (!bytes || bytes.length !== asset.size || !detectImage(bytes) || detectImage(bytes)?.mime !== asset.mimeType) {
        throw new Error(`备份中的图片 ${asset.originalName} 不完整或类型不匹配`);
      }
      const newId = assetIds.get(asset.id);
      if (!newId) throw new Error("备份中的图片关联无效");
      const storagePath = `${newId}.${extension}`;
      const destination = path.join(uploadDirectory, storagePath);
      const handle = await fs.open(destination, "wx", 0o600);
      createdFiles.push(destination);
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      assetRows.push({
        id: newId, oldId: asset.id, mimeType: asset.mimeType,
        originalName: safeFileName(path.basename(asset.originalName), 200),
        storagePath, size: bytes.length
      });
    }

    const insertedAt = nowIso();
    const insertAll = sqlite.transaction(() => {
      const insertFolder = sqlite.prepare("INSERT INTO folders (id,user_id,name,sort_order,is_default,created_at,updated_at) VALUES (?,?,?,?,0,?,?)");
      for (const folder of importedFolders) {
        if (folder.isDefault) continue;
        insertFolder.run(folderIds.get(folder.id), targetUserId, `恢复 · ${folder.name}`.slice(0, 80), folder.sortOrder, insertedAt, insertedAt);
      }
      const insertAsset = sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?,?,?,?,?,?,?)");
      for (const asset of assetRows) insertAsset.run(asset.id, targetUserId, asset.storagePath, asset.mimeType, asset.originalName, asset.size, insertedAt);
      for (const entry of knowledge.entries) {
        const id = entryIds.get(entry.id)!;
        sqlite.prepare("INSERT INTO knowledge_entries (id,user_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, targetUserId, entry.title, rewriteAssets(JSON.stringify(entry.content), assetIds, entryIds), entry.createdAt, entry.updatedAt);
        replaceEntryNames(targetUserId, id, entry.title, entry.aliases);
      }
      for (const tag of knowledge.tags) {
        const normalized=normalizeKnowledgeName(tag.name);
        const existing=sqlite.prepare("SELECT id FROM tags WHERE user_id=? AND normalized_name=?").get(targetUserId,normalized) as { id: string } | undefined;
        if (existing) tagIds.set(tag.id,existing.id);
        else sqlite.prepare("INSERT INTO tags (id,user_id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(tagIds.get(tag.id),targetUserId,tag.name,normalized,insertedAt,insertedAt);
      }
      const insertNotebook = sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,cover_asset_id,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
      for (const notebook of importedNotebooks) {
        const coverId = notebook.coverAssetId ? assetIds.get(notebook.coverAssetId) ?? null : null;
        insertNotebook.run(notebookIds.get(notebook.id), targetUserId, folderIds.get(notebook.folderId), notebook.title, coverId, notebook.sortOrder, insertedAt, insertedAt);
      }
      const insertPage = sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,title,content,sort_order,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)");
      for (const page of importedPages) {
        const content = rewriteAssets(page.content, assetIds, entryIds);
        insertPage.run(pageIds.get(page.id), targetUserId, notebookIds.get(page.notebookId), page.title, content, page.sortOrder, page.createdAt, page.updatedAt);
      }
      const insertSnapshot = sqlite.prepare("INSERT INTO note_snapshots (id,user_id,page_id,title,content,created_at) VALUES (?,?,?,?,?,?)");
      for (const snapshot of importedSnapshots) {
        const mappedPageId = pageIds.get(snapshot.pageId);
        if (!mappedPageId) throw new Error("备份中的历史版本页面引用无效");
        insertSnapshot.run(crypto.randomUUID(), targetUserId, mappedPageId, snapshot.title, rewriteAssets(snapshot.content, assetIds, entryIds), snapshot.createdAt);
      }
      const assign=(kind: string,id: string,ids: string[]) => { for(const tag of new Set(ids)) sqlite.prepare("INSERT OR IGNORE INTO content_tags (tag_id,source_type,source_id) VALUES (?,?,?)").run(tagIds.get(tag),kind,id); };
      for (const entry of knowledge.entries) assign("entry",entryIds.get(entry.id)!,entry.tagIds);
      for (const item of knowledge.pageTags) assign("page",pageIds.get(item.pageId)!,item.tagIds);
    });
    insertAll();
    return { entries: knowledge.entries.length, tags: knowledge.tags.length, folders: importedFolders.filter((folder) => !folder.isDefault).length, notebooks: importedNotebooks.length, pages: importedPages.length, snapshots: importedSnapshots.length, assets: assetRows.length };
  } catch (error) {
    await Promise.all(createdFiles.map((file) => fs.rm(file, { force: true })));
    throw error;
  }
}

function rewriteAssets(content: string, assetIds: Map<string, string>, entryIds: Map<string, string>) {
  let document: unknown;
  try { document = JSON.parse(content); } catch { throw new Error("备份中的页面内容不是有效 JSON"); }
  if (!document || typeof document !== "object" || (document as { type?: string }).type !== "doc") throw new Error("备份中的页面内容格式无效");
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const item = { ...(value as Record<string, unknown>) };
    if (item.attrs && typeof item.attrs === "object") {
      const attrs = { ...(item.attrs as Record<string, unknown>) };
      const oldId = typeof attrs.assetId === "string" ? attrs.assetId : extractAssetId(attrs.src);
      if (oldId) {
        const replacement = assetIds.get(oldId);
        if (!replacement) throw new Error("备份中的图片引用不存在");
        attrs.assetId = replacement;
        attrs.src = `/uploads/notes/${replacement}`;
      }
      item.attrs = attrs;
    }
    if (item.content) item.content = visit(item.content);
    return item;
  };
  return JSON.stringify(mapKnowledgeReferences(visit(document), (id) => entryIds.get(id) ?? id));
}

function extractAssetId(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^\/uploads\/notes\/([0-9a-f-]{36})$/i.exec(value);
  return match?.[1] ?? null;
}
