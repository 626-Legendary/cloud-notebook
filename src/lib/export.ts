import archiver from "archiver";
import Database from "better-sqlite3";
import fs from "node:fs";
import { PassThrough, Readable } from "node:stream";
import { count, eq } from "drizzle-orm";
import { databaseFile, db, sqlite } from "@/db";
import { assets, folders, noteSnapshots, notebooks, pages, users } from "@/db/schema";
import { extensionForMime } from "@/lib/images";
import { contentToMarkdown } from "@/lib/markdown";
import { getEntry } from "@/lib/knowledge";
import type { CnfKnowledge } from "@/lib/cnf-format";
import { safeFileName } from "@/lib/filename";

export async function createUserExport(userId: string) {
  const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");
  const [userFolders, userNotebooks, [pageCount], [snapshotCount], userAssets] = await Promise.all([
    db.select().from(folders).where(eq(folders.userId, userId)),
    db.select().from(notebooks).where(eq(notebooks.userId, userId)),
    db.select({ value: count() }).from(pages).where(eq(pages.userId, userId)),
    db.select({ value: count() }).from(noteSnapshots).where(eq(noteSnapshots.userId, userId)),
    db.select().from(assets).where(eq(assets.userId, userId))
  ]);
  const assetFiles = userAssets.map((asset) => {
    const extension = extensionForMime(asset.mimeType);
    const file = `${process.cwd()}/data/uploads/notes/${asset.storagePath}`;
    if (!extension || !fs.existsSync(file)) throw new Error(`附件文件缺失：${asset.originalName}`);
    return { asset, extension, file };
  });
  const knowledge = sqlite.transaction((): CnfKnowledge => {
    const entries = sqlite.prepare("SELECT id FROM knowledge_entries WHERE user_id=? AND deleted_at IS NULL").all(userId) as { id: string }[];
    return {
      entries: entries.map(({ id }) => { const entry = getEntry(userId, id); return { id, title: entry.title, aliases: entry.aliases, content: JSON.parse(entry.content) as Record<string, unknown>, createdAt: entry.createdAt, updatedAt: entry.updatedAt, tagIds: [] }; }),
      tags: [], pageTags: []
    };
  })();
  const stream = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (error) => stream.destroy(error));
  archive.pipe(stream);
  const exportAssets = userAssets.map(({ id, mimeType, originalName, size, createdAt }) => ({ id, mimeType, originalName, size, createdAt }));
  const manifest = { formatVersion: 2, knowledgeCount: knowledge.entries.length, tagCount: knowledge.tags.length, username: user.username, exportedAt: new Date().toISOString(), folderCount: userFolders.length, notebookCount: userNotebooks.length, pageCount: pageCount.value, snapshotCount: snapshotCount.value, assetCount: userAssets.length };
  const deletedKnowledge = sqlite.prepare("SELECT id,title,content,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt FROM knowledge_entries WHERE user_id=? AND deleted_at IS NOT NULL").all(userId);
  archive.append(JSON.stringify(deletedKnowledge), { name: "deleted-knowledge.json" });
  archive.append(JSON.stringify(knowledge), { name: "knowledge.json" });
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.append(JSON.stringify(userFolders, null, 2), { name: "folders.json" });
  archive.append(JSON.stringify(userNotebooks, null, 2), { name: "notebooks.json" });
  archive.append(JSON.stringify(exportAssets, null, 2), { name: "assets.json" });
  const notebookById = new Map(userNotebooks.map((notebook) => [notebook.id, notebook]));
  const pageFileRows = sqlite.prepare(`
    SELECT id, notebook_id AS notebookId, title, content FROM pages WHERE user_id = ? ORDER BY notebook_id, sort_order
  `).iterate(userId) as Iterable<{ id: string; notebookId: string; title: string; content: string }>;
  for (const page of pageFileRows) {
    const notebook = notebookById.get(page.notebookId);
    const folderName = notebook?.title ?? "Notebook";
    const safeName = safeFileName(page.title || "无标题");
    const base = `notebooks/${safeFileName(folderName)}/${safeName}-${page.id}`;
    archive.append(page.content, { name: `${base}.json` });
    let markdown = contentToMarkdown(page.content);
    for (const asset of userAssets) {
      const extension = extensionForMime(asset.mimeType);
      if (extension) markdown = markdown.replaceAll(`/uploads/notes/${asset.id}`, `../../assets/${asset.id}.${extension}`);
    }
    archive.append(markdown, { name: `${base}.md` });
  }
  for (const { asset, extension, file } of assetFiles) {
    archive.file(file, { name: `assets/${asset.id}.${extension}` });
  }
  const pageExportDb = new Database(databaseFile, { readonly: true, fileMustExist: true });
  let snapshotExportDb: Database.Database | undefined;
  try {
    snapshotExportDb = new Database(databaseFile, { readonly: true, fileMustExist: true });
    const pageRows = pageExportDb.prepare(`
      SELECT id, user_id AS userId, notebook_id AS notebookId, title, content,
             deleted_at AS deletedAt, pinned_at AS pinnedAt, pin_sort_order AS pinSortOrder, sort_order AS sortOrder, version, created_at AS createdAt, updated_at AS updatedAt
      FROM pages WHERE user_id = ? ORDER BY notebook_id, sort_order
    `).iterate(userId) as Iterable<Record<string, unknown>>;
    const snapshotRows = snapshotExportDb.prepare(`
      SELECT id, user_id AS userId, page_id AS pageId, title, content, created_at AS createdAt
      FROM note_snapshots WHERE user_id = ? ORDER BY created_at
    `).iterate(userId) as Iterable<Record<string, unknown>>;
    archive.append(Readable.from(rowsAsJson(pageRows, pageExportDb)), { name: "pages.json" });
    archive.append(Readable.from(rowsAsJson(snapshotRows, snapshotExportDb)), { name: "snapshots.json" });
  } catch (error) {
    pageExportDb.close();
    snapshotExportDb?.close();
    archive.abort();
    stream.destroy();
    throw error;
  }
  void archive.finalize().catch((error: Error) => stream.destroy(error));
  return stream;
}

async function* rowsAsJson<T>(rows: Iterable<T>, database: Database.Database) {
  try {
    yield "[";
    let first = true;
    for (const row of rows) {
      yield `${first ? "" : ","}${JSON.stringify(row)}`;
      first = false;
    }
    yield "]";
  } finally {
    database.close();
  }
}
