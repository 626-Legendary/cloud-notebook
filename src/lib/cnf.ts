import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/db";
import { CnfError, CNF_LIMITS, cnfNotebookSchema, createCnfZip, mapDocumentAssets, parseCnf, sha256, type CnfManifest } from "@/lib/cnf-format";
import { detectImage, extensionForMime } from "@/lib/images";
import { safeFileName } from "@/lib/filename";

type AssetRow = { id: string; userId: string; storagePath: string; mimeType: string; originalName: string; size: number; createdAt: string };
const notebookColumns = "id,title,cover_asset_id AS coverAssetId,sort_order AS sortOrder,deleted_at AS deletedAt,pinned_at AS pinnedAt,pin_sort_order AS pinSortOrder,created_at AS createdAt,updated_at AS updatedAt";
const pageColumns = "id,title,content,version,sort_order AS sortOrder,deleted_at AS deletedAt,pinned_at AS pinnedAt,pin_sort_order AS pinSortOrder,created_at AS createdAt,updated_at AS updatedAt";
const uploads = () => path.resolve(process.cwd(), "data/uploads/notes");

export async function exportNotebookCnf(userId: string, notebookId: string) {
  // One SQLite read snapshot, including trash pages and retained history in this notebook.
  const snapshot = sqlite.transaction(() => {
    const notebook = sqlite.prepare(`SELECT ${notebookColumns} FROM notebooks WHERE id=? AND user_id=? AND deleted_at IS NULL`).get(notebookId, userId) as Record<string, unknown> | undefined;
    if (!notebook) throw new CnfError("笔记本不存在", 404);
    const pages = sqlite.prepare(`SELECT ${pageColumns} FROM pages WHERE notebook_id=? AND user_id=? ORDER BY sort_order,created_at`).all(notebookId, userId) as (Record<string, unknown> & { content: string })[];
    const snapshots = sqlite.prepare(`SELECT s.id,s.page_id AS pageId,s.title,s.content,s.created_at AS createdAt FROM note_snapshots s JOIN pages p ON p.id=s.page_id WHERE p.notebook_id=? AND p.user_id=? AND s.user_id=? ORDER BY s.created_at,s.id`).all(notebookId, userId, userId) as (Record<string, unknown> & { content: string })[];
    return { ...notebook, pages: pages.map((page) => ({ ...page, content: JSON.parse(page.content) as unknown })), snapshots: snapshots.map((item) => ({ ...item, content: JSON.parse(item.content) as unknown })) };
  })();
  const resources = new Map<string, AssetRow>();
  const resolveAsset = (id: string) => {
    if (resources.has(id)) return resources.get(id)!;
    const asset = sqlite.prepare("SELECT id,user_id AS userId,storage_path AS storagePath,mime_type AS mimeType,original_name AS originalName,size,created_at AS createdAt FROM assets WHERE id=? AND user_id=?").get(id, userId) as AssetRow | undefined;
    if (!asset || !extensionForMime(asset.mimeType)) throw new CnfError("笔记本引用了缺失或无权访问的图片");
    if (!/^[0-9a-f-]{36}\.(?:png|jpg|jpeg|webp|gif)$/i.test(asset.storagePath) || path.basename(asset.storagePath) !== asset.storagePath || !asset.storagePath.toLowerCase().startsWith(`${asset.id.toLowerCase()}.`)) throw new CnfError("图片存储路径不安全");
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
  const entries = new Map<string, Buffer>();
  const assetManifest: CnfManifest["assets"] = [];
  let total = 0;
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
  const data = Buffer.from(JSON.stringify(notebook));
  const manifest: CnfManifest = { format: "cloud-notebook-file", formatVersion: 1, applicationVersion: process.env.APP_VERSION?.trim() || "1.0.1112", exportedAt: new Date().toISOString(), notebookId, compatibility: { editor: "tiptap-json", schemaVersion: 1, assets: "relative-v1" }, notebookSha256: sha256(data), pageCount: notebook.pages.length, snapshotCount: notebook.snapshots.length, assets: assetManifest };
  entries.set("notebook.json", data);
  entries.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  return { bytes: await createCnfZip(entries), filename: `${safeFileName(notebook.title)}.cnf` };
}

export async function importNotebookCnf(userId: string, bytes: Buffer) {
  // Validate the full archive, references and editor compatibility before any file/DB write.
  const { manifest, notebook, entries } = await parseCnf(bytes);
  const folder = sqlite.prepare("SELECT id FROM folders WHERE user_id=? AND is_default=1").get(userId) as { id: string } | undefined;
  if (!folder) throw new CnfError("账号缺少默认文件夹");
  const notebookId = crypto.randomUUID();
  const assetIds = new Map(manifest.assets.map((asset) => [asset.id, crypto.randomUUID()]));
  const pageIds = new Map(notebook.pages.map((page) => [page.id, crypto.randomUUID()]));
  const paths = new Map(manifest.assets.map((asset) => [asset.path, `/uploads/notes/${assetIds.get(asset.id)}`]));
  const rewrite = (doc: Record<string, unknown>) => JSON.stringify(mapDocumentAssets(doc, (value, key) => key === "assetId" ? assetIds.get(value)! : paths.get(value) ?? value));
  const pageContents = notebook.pages.map((page) => rewrite(page.content));
  const snapshotContents = notebook.snapshots.map((snapshot) => rewrite(snapshot.content));
  const createdFiles: string[] = [];
  const assetRows = manifest.assets.map((asset) => ({ ...asset, newId: assetIds.get(asset.id)!, storagePath: `${assetIds.get(asset.id)}.${extensionForMime(asset.mimeType)}` }));
  try {
    await fs.mkdir(uploads(), { recursive: true });
    for (const asset of assetRows) {
      const file = path.join(uploads(), asset.storagePath);
      // Only remove files we created, including a failed partial write.
      const handle = await fs.open(file, "wx", 0o600);
      createdFiles.push(file);
      try { await handle.writeFile(entries.get(asset.path)!); } finally { await handle.close(); }
    }
    sqlite.transaction(() => {
      if (!sqlite.prepare("SELECT id FROM folders WHERE id=? AND user_id=?").get(folder.id, userId)) throw new CnfError("导入目标文件夹已改变，请重试");
      const insertAsset = sqlite.prepare("INSERT INTO assets (id,user_id,storage_path,mime_type,original_name,size,created_at) VALUES (?,?,?,?,?,?,?)");
      for (const asset of assetRows) insertAsset.run(asset.newId, userId, asset.storagePath, asset.mimeType, safeFileName(asset.originalName, 200), asset.size, asset.createdAt);
      sqlite.prepare("INSERT INTO notebooks (id,user_id,folder_id,title,cover_asset_id,sort_order,pinned_at,pin_sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(notebookId, userId, folder.id, notebook.title, notebook.coverAssetId ? assetIds.get(notebook.coverAssetId) : null, notebook.sortOrder, notebook.pinnedAt, notebook.pinSortOrder, notebook.createdAt, notebook.updatedAt);
      const insertPage = sqlite.prepare("INSERT INTO pages (id,user_id,notebook_id,title,content,sort_order,version,deleted_at,pinned_at,pin_sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?,?)");
      notebook.pages.forEach((page, index) => insertPage.run(pageIds.get(page.id), userId, notebookId, page.title, pageContents[index], page.sortOrder, page.deletedAt, page.pinnedAt, page.pinSortOrder, page.createdAt, page.updatedAt));
      const insertSnapshot = sqlite.prepare("INSERT INTO note_snapshots (id,user_id,page_id,title,content,created_at) VALUES (?,?,?,?,?,?)");
      notebook.snapshots.forEach((snapshot, index) => insertSnapshot.run(crypto.randomUUID(), userId, pageIds.get(snapshot.pageId), snapshot.title, snapshotContents[index], snapshot.createdAt));
    })();
  } catch (error) {
    await Promise.all(createdFiles.map((file) => fs.rm(file, { force: true })));
    throw error;
  }
  return { id: notebookId, title: notebook.title, pages: notebook.pages.length, assets: manifest.assets.length };
}
