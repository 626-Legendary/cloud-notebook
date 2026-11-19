import { planKnowledgeImport, type ImportPolicy } from "@/lib/knowledge-import";
import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/db";
import { CnfError, CNF_LIMITS, cnfNotebookSchema, createCnfZip, mapDocumentAssets, parseCnf, sha256, type CnfManifest, type CnfKnowledge } from "@/lib/cnf-format";
import { detectImage, extensionForMime } from "@/lib/images";
import { getEntry, replaceEntryNames } from "@/lib/knowledge";
import { documentReferences, mapKnowledgeReferences } from "@/lib/knowledge-document";
import { safeFileName } from "@/lib/filename";

type AssetRow = { id: string; userId: string; storagePath: string; mimeType: string; originalName: string; size: number; createdAt: string };
const notebookColumns = "id,title,cover_asset_id AS coverAssetId,sort_order AS sortOrder,deleted_at AS deletedAt,pinned_at AS pinnedAt,pin_sort_order AS pinSortOrder,created_at AS createdAt,updated_at AS updatedAt";
const pageColumns = "id,title,content,version,sort_order AS sortOrder,deleted_at AS deletedAt,pinned_at AS pinnedAt,pin_sort_order AS pinSortOrder,created_at AS createdAt,updated_at AS updatedAt";
const uploads = () => path.resolve(process.cwd(), "data/uploads/notes");

async function exportCnf(userId: string, notebookId: string, scope: CnfManifest["scope"] = "notebook", pageId?: string) {
  // Capture documents, names and asset metadata in one short SQLite snapshot.
  const { notebook, knowledge, resources, portablePath } = sqlite.transaction(() => {
    let rawBytes = 0;
    const budget = (bytes: number) => { rawBytes += bytes; if (rawBytes > CNF_LIMITS.expanded) throw new CnfError("导出正文超过 200 MB"); };
    const snapshot = (() => {
      if (scope === "knowledge") { const now = new Date().toISOString(); return { id: crypto.randomUUID(), title: "知识库", sortOrder: 0, deletedAt: null, pinnedAt: null, pinSortOrder: 0, createdAt: now, updatedAt: now, coverAssetId: null, pages: [], snapshots: [] }; }
      const notebook = sqlite.prepare(`SELECT ${notebookColumns} FROM notebooks WHERE id=? AND user_id=? AND deleted_at IS NULL`).get(notebookId, userId) as Record<string, unknown> | undefined;
      if (!notebook) throw new CnfError("笔记本不存在", 404);
      const pageSize = sqlite.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM pages WHERE notebook_id=? AND user_id=? AND (? IS NULL OR id=?)").get(notebookId, userId, pageId ?? null, pageId ?? null) as { n: number; bytes: number };
      const snapshotSize = sqlite.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(s.content AS BLOB))),0) AS bytes FROM note_snapshots s JOIN pages p ON p.id=s.page_id WHERE p.notebook_id=? AND p.user_id=? AND s.user_id=? AND (? IS NULL OR s.page_id=?)").get(notebookId, userId, userId, pageId ?? null, pageId ?? null) as { n: number; bytes: number };
      if (pageSize.n > 10_000 || snapshotSize.n > 50_000) throw new CnfError("页面或历史版本数量超过导出限制"); budget(pageSize.bytes + snapshotSize.bytes);
      const pages = sqlite.prepare(`SELECT ${pageColumns} FROM pages WHERE notebook_id=? AND user_id=? AND (? IS NULL OR id=?) ORDER BY sort_order,created_at`).all(notebookId, userId, pageId ?? null, pageId ?? null) as (Record<string, unknown> & { content: string })[];
      const snapshots = sqlite.prepare(`SELECT s.id,s.page_id AS pageId,s.title,s.content,s.created_at AS createdAt FROM note_snapshots s JOIN pages p ON p.id=s.page_id WHERE p.notebook_id=? AND p.user_id=? AND s.user_id=? AND (? IS NULL OR s.page_id=?) ORDER BY s.created_at,s.id`).all(notebookId, userId, userId, pageId ?? null, pageId ?? null) as (Record<string, unknown> & { content: string })[];
      return { ...notebook, pages: pages.filter((page) => !pageId || page.id === pageId).map((page) => ({ ...page, content: JSON.parse(page.content) as unknown })), snapshots: snapshots.filter((item) => !pageId || item.pageId === pageId).map((item) => ({ ...item, content: JSON.parse(item.content) as unknown })) };
    })();
    const referenced = new Set<string>();
    for (const document of [...snapshot.pages, ...snapshot.snapshots]) for (const reference of documentReferences(document.content)) referenced.add(reference.entryId);
    const entryRows = sqlite.prepare("SELECT id,length(CAST(content AS BLOB)) AS bytes FROM knowledge_entries WHERE user_id=? AND deleted_at IS NULL").all(userId) as { id: string; bytes: number }[];
    const packedRows = entryRows.filter((row) => scope === "knowledge" || referenced.has(row.id));
    if (packedRows.length > 10_000) throw new CnfError("词条数量超过导出限制");
    for (const row of packedRows) budget(row.bytes);
    const packed = packedRows.map((row) => getEntry(userId, row.id));
    const resources = new Map<string, AssetRow>();
    const resolveAsset = (id: string) => {
      if (resources.has(id)) return resources.get(id)!;
      const asset = sqlite.prepare("SELECT id,user_id AS userId,storage_path AS storagePath,mime_type AS mimeType,original_name AS originalName,size,created_at AS createdAt FROM assets WHERE id=? AND user_id=?").get(id, userId) as AssetRow | undefined;
      if (!asset || !extensionForMime(asset.mimeType)) throw new CnfError("笔记本引用了缺失或无权访问的图片");
      if (!/^[0-9a-f-]{36}\.(?:png|jpg|jpeg|webp|gif)$/i.test(asset.storagePath) || path.basename(asset.storagePath) !== asset.storagePath || !asset.storagePath.toLowerCase().startsWith(`${asset.id.toLowerCase()}.`)) throw new CnfError("图片存储路径不安全");
      if (resources.size >= 20_000) throw new CnfError("图片数量超过导出限制");
      resources.set(id, asset);
      return asset;
    };
    const portablePath = (id: string) => {
      const asset = resolveAsset(id);
      return `assets/${asset.id}.${extensionForMime(asset.mimeType)}`;
    };
    const portable = (document: unknown) => {
      const result = mapDocumentAssets(document, (value, key) => {
        if (key === "assetId") { resolveAsset(value); return value; }
        const match = /^(?:https?:\/\/[^/]+)?\/uploads\/notes\/([0-9a-f-]{36})(?:\?[^#]*)?(?:#.*)?$/i.exec(value);
        if (match) return portablePath(match[1]);
        if (/^\/uploads\/notes\//.test(value)) throw new CnfError("正文包含无法识别的本地图片引用");
        return value;
      });
      const checkImages = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const item = node as { type?: string; attrs?: { src?: string; assetId?: string }; content?: unknown[] };
        if (item.type === "image") {
          if (!item.attrs?.src?.startsWith("assets/")) throw new CnfError("正文含外部或内嵌图片，请先上传为本地图片后再导出 CNF");
          if (item.attrs.assetId && portablePath(item.attrs.assetId) !== item.attrs.src) throw new CnfError("正文图片标识与路径不一致，请先修复该图片");
        }
        item.content?.forEach(checkImages);
      };
      checkImages(result);
      return result;
    };
    const notebook = cnfNotebookSchema.parse({ ...snapshot, pages: snapshot.pages.map((page) => ({ ...page, content: portable(page.content) })), snapshots: snapshot.snapshots.map((item) => ({ ...item, content: portable(item.content) })) });
    if (notebook.coverAssetId) resolveAsset(notebook.coverAssetId);

    const knowledge: CnfKnowledge = {
      entries: packed.map((entry) => ({ id: entry.id, title: entry.title, aliases: entry.aliases, content: portable(JSON.parse(entry.content)), createdAt: entry.createdAt, updatedAt: entry.updatedAt, tagIds: [] })),
      tags: [], pageTags: []
    };

    return { notebook, knowledge, resources, portablePath };
  })();
  const entries = new Map<string, Buffer>();
  const assetManifest: CnfManifest["assets"] = [];
  const data = Buffer.from(JSON.stringify(notebook)), knowledgeData = Buffer.from(JSON.stringify(knowledge));
  let total = data.length + knowledgeData.length;
  for (const asset of resources.values()) {
    const file = path.join(uploads(), asset.storagePath);
    let bytes: Buffer;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CNF_LIMITS.image) throw new Error();
      bytes = await fs.readFile(file);
    } catch { throw new CnfError(`图片缺失、不安全或超过 10 MB：${asset.originalName}`); }
    if (bytes.length !== asset.size || detectImage(bytes)?.mime !== asset.mimeType) throw new CnfError(`图片文件不完整：${asset.originalName}`);
    total += bytes.length;
    if (total > CNF_LIMITS.expanded) throw new CnfError("笔记本资源超过 200 MB");
    const entryPath = portablePath(asset.id);
    entries.set(entryPath, bytes);
    assetManifest.push({ id: asset.id, path: entryPath, mimeType: asset.mimeType as CnfManifest["assets"][number]["mimeType"], originalName: asset.originalName, size: bytes.length, createdAt: asset.createdAt, sha256: sha256(bytes) });
  }
  const manifest: CnfManifest = { format: "cloud-notebook-file", formatVersion: 2, scope, applicationVersion: process.env.APP_VERSION?.trim() || "1.1.1119b", exportedAt: new Date().toISOString(), notebookId: notebook.id, compatibility: { editor: "tiptap-json", schemaVersion: 2, assets: "relative-v1" }, notebookSha256: sha256(data), knowledgeSha256: sha256(knowledgeData), pageCount: notebook.pages.length, snapshotCount: notebook.snapshots.length, assets: assetManifest };
  entries.set("notebook.json", data);
  entries.set("knowledge.json", knowledgeData);
  entries.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  return { bytes: await createCnfZip(entries), filename: `${safeFileName(scope === "page" ? notebook.pages[0].title : notebook.title)}.cnf` };
}

export async function importNotebookCnf(userId: string, bytes: Buffer, policy: ImportPolicy | boolean = "reject") {
  // Validate the full archive, references and editor compatibility before any file/DB write.
  const { manifest, notebook, knowledge, entries } = await parseCnf(bytes);
  const selectedPolicy = typeof policy === "boolean" ? (policy ? "reuse" : "reject") : policy;
  const plans = planKnowledgeImport(userId, knowledge.entries, selectedPolicy);
  const plansById = new Map(plans.map((item) => [item.sourceId, item]));
  const entryIds = new Map(plans.map((item) => [item.sourceId, item.id]));
  const reused = new Set(plans.filter((item) => item.reused).map((item) => item.sourceId));
  const folder = sqlite.prepare("SELECT id FROM folders WHERE user_id=? AND is_default=1").get(userId) as { id: string } | undefined;
  if (!folder) throw new CnfError("账号缺少默认文件夹");
  const notebookId = crypto.randomUUID();
  const assetIds = new Map(manifest.assets.map((asset) => [asset.id, crypto.randomUUID()]));
  const pageIds = new Map(notebook.pages.map((page) => [page.id, crypto.randomUUID()]));
  const paths = new Map(manifest.assets.map((asset) => [asset.path, `/uploads/notes/${assetIds.get(asset.id)}`]));
  const rewrite = (doc: Record<string, unknown>) => JSON.stringify(mapKnowledgeReferences(mapDocumentAssets(doc, (value, key) => key === "assetId" ? assetIds.get(value)! : paths.get(value) ?? value), (id) => entryIds.get(id) ?? id));
  const pageContents = notebook.pages.map((page) => rewrite(page.content));
  const snapshotContents = notebook.snapshots.map((snapshot) => rewrite(snapshot.content));
  const createdFiles: string[] = [];
  const assetRows = manifest.assets.map((asset) => ({ ...asset, newId: assetIds.get(asset.id)!, storagePath: `${assetIds.get(asset.id)}.${extensionForMime(asset.mimeType)}` }));
  try {
    await fs.mkdir(uploads(), { recursive: true });
    const rootStat = await fs.lstat(uploads());
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(uploads()) !== path.join(await fs.realpath(process.cwd()), "data/uploads/notes")) throw new CnfError("图片存储目录不安全");
    for (const asset of assetRows) {
      const file = path.join(uploads(), asset.storagePath);
      // Only remove files we created, including a failed partial write.
      const handle = await fs.open(file, "wx", 0o600);
      createdFiles.push(file);
      try { await handle.writeFile(entries.get(asset.path)!); } finally { await handle.close(); }
    }
    sqlite.transaction(() => {
      // Reject name changes since preflight rather than silently retargeting imported references.
      const rechecked = new Map(planKnowledgeImport(userId, knowledge.entries, selectedPolicy).map((item) => [item.sourceId, item]));
      for (const plan of plans) {
        const next = rechecked.get(plan.sourceId)!;
        if (next.reused !== plan.reused || next.reused && next.id !== plan.id || next.title !== plan.title || JSON.stringify(next.aliases) !== JSON.stringify(plan.aliases)) throw new CnfError("目标知识库已改变，请重新导入", 409);
      }
      if (!sqlite.prepare("SELECT id FROM folders WHERE id=? AND user_id=?").get(folder.id, userId)) throw new CnfError("导入目标文件夹已改变，请重试");
      const insertAsset = sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?,?,?,?,?,?,?)");
      for (const asset of assetRows) insertAsset.run(asset.newId, userId, asset.storagePath, asset.mimeType, safeFileName(asset.originalName, 200), asset.size, asset.createdAt);
      for (const entry of knowledge.entries) {
        const plan = plansById.get(entry.id)!;
        const id = entryIds.get(entry.id)!;
        if (reused.has(entry.id)) { getEntry(userId, id); continue; }
        sqlite.prepare("INSERT INTO knowledge_entries (id,user_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, userId, plan.title, rewrite(entry.content), entry.createdAt, entry.updatedAt);
        replaceEntryNames(userId, id, plan.title, plan.aliases);
      }
      if (manifest.scope !== "knowledge") sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,cover_asset_id,sort_order,pinned_at,pin_sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(notebookId, userId, folder.id, notebook.title, notebook.coverAssetId ? assetIds.get(notebook.coverAssetId) : null, notebook.sortOrder, notebook.pinnedAt, notebook.pinSortOrder, notebook.createdAt, notebook.updatedAt);
      const insertPage = sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,title,content,sort_order,version,deleted_at,pinned_at,pin_sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?,?)");
      notebook.pages.forEach((page, index) => insertPage.run(pageIds.get(page.id), userId, notebookId, page.title, pageContents[index], page.sortOrder, page.deletedAt, page.pinnedAt, page.pinSortOrder, page.createdAt, page.updatedAt));
      const insertSnapshot = sqlite.prepare("INSERT INTO note_snapshots (id,user_id,page_id,title,content,created_at) VALUES (?,?,?,?,?,?)");
      notebook.snapshots.forEach((snapshot, index) => insertSnapshot.run(crypto.randomUUID(), userId, pageIds.get(snapshot.pageId), snapshot.title, snapshotContents[index], snapshot.createdAt));


    })();
  } catch (error) {
    await Promise.all(createdFiles.map((file) => fs.rm(file, { force: true })));
    throw error;
  }
  return { kind: manifest.scope, entries: knowledge.entries.length, reusedEntries: reused.size, renamedEntries: plans.filter((item) => item.renamed).length, id: manifest.scope === "knowledge" ? "" : notebookId, title: notebook.title, pages: notebook.pages.length, assets: manifest.assets.length };
}

export function exportNotebookCnf(userId: string, notebookId: string) { return exportCnf(userId, notebookId); }
export function exportKnowledgeCnf(userId: string) { return exportCnf(userId, "", "knowledge"); }
export function exportPageCnf(userId: string, pageId: string) {
  const row = sqlite.prepare("SELECT notebook_id AS notebookId FROM pages WHERE id=? AND user_id=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM notebooks n WHERE n.id=pages.notebook_id AND n.deleted_at IS NULL)").get(pageId, userId) as { notebookId: string } | undefined;
  if (!row) throw new CnfError("页面不存在", 404);
  return exportCnf(userId, row.notebookId, "page", pageId);
}
