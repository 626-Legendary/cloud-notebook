import { createHash } from "node:crypto";
import archiver from "archiver";
import { getSchema, type JSONContent } from "@tiptap/core";
import { z } from "zod";
import { documentExtensions } from "@/lib/editor-extensions";
import { detectImage } from "@/lib/images";
import { readZipEntries } from "@/lib/zip-reader";

export const CNF_LIMITS = { compressed: 100 * 1024 * 1024, expanded: 200 * 1024 * 1024, image: 10 * 1024 * 1024, entries: 20_002 };
export class CnfError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const order = z.number().int().safe();
const metadata = {
  id: uuid, title: z.string().min(1).max(200), sortOrder: order,
  createdAt: timestamp, updatedAt: timestamp, deletedAt: timestamp.nullable(),
  pinnedAt: timestamp.nullable(), pinSortOrder: order
};
export const cnfNotebookSchema = z.object({
  ...metadata, deletedAt: z.null(), title: z.string().min(1).max(120), coverAssetId: uuid.nullable(),
  pages: z.array(z.object({ ...metadata, version: z.number().int().positive(), content: z.record(z.unknown()) }).strict()).max(10_000),
  snapshots: z.array(z.object({ id: uuid, pageId: uuid, title: z.string().min(1).max(200), content: z.record(z.unknown()), createdAt: timestamp }).strict()).max(50_000)
}).strict();
const assetSchema = z.object({
  id: uuid, path: z.string().regex(/^assets\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  originalName: z.string().max(200), size: z.number().int().positive().max(CNF_LIMITS.image),
  createdAt: timestamp, sha256: digest
}).strict();
export const cnfManifestSchema = z.object({
  format: z.literal("cloud-notebook-file"), formatVersion: z.literal(1),
  applicationVersion: z.string().min(1).max(40), exportedAt: timestamp, notebookId: uuid,
  compatibility: z.object({ editor: z.literal("tiptap-json"), schemaVersion: z.literal(1), assets: z.literal("relative-v1") }).strict(),
  notebookSha256: digest, pageCount: z.number().int().nonnegative(), snapshotCount: z.number().int().nonnegative(),
  assets: z.array(assetSchema).max(20_000)
}).strict();
export type CnfNotebook = z.infer<typeof cnfNotebookSchema>;
export type CnfManifest = z.infer<typeof cnfManifestSchema>;
export const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** Transform only attributes, keeping all content, text, marks and attributes intact. */
export function mapDocumentAssets(document: unknown, resolve: (value: string, key: string) => string): Record<string, unknown> {
  let count = 0;
  const visit = (value: unknown, depth: number, inAttrs: boolean, key = ""): unknown => {
    if (depth > 100 || ++count > 500_000) throw new CnfError("正文嵌套层级或节点数量超过上限");
    if (typeof value === "string") return inAttrs ? resolve(value, key) : value;
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1, inAttrs));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, depth + 1, inAttrs || name === "attrs", name)]));
  };
  const result = visit(document, 0, false);
  if (!result || typeof result !== "object" || Array.isArray(result) || (result as Record<string, unknown>).type !== "doc") throw new CnfError("正文不是有效的编辑器文档");
  if (Buffer.byteLength(JSON.stringify(result)) > 2_000_000) throw new CnfError("单篇正文不能超过 2 MB");
  return result as Record<string, unknown>;
}

let schema: ReturnType<typeof getSchema> | undefined;
/** Reject capabilities this editor would drop; never normalize the stored JSON. */
export function validateEditableDocument(document: Record<string, unknown>) {
  schema ??= getSchema(documentExtensions());
  const currentSchema = schema;
  const check = (value: unknown, isMark = false): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CnfError("正文节点格式无效");
    const node = value as Record<string, unknown>;
    const type = typeof node.type === "string" ? (isMark ? currentSchema.marks[node.type] : currentSchema.nodes[node.type]) : undefined;
    if (!type) throw new CnfError(`当前编辑器不支持节点或标记：${String(node.type)}，未导入任何内容`);
    if (Object.keys(node).some((key) => !["type", "attrs", "text", "content", "marks"].includes(key))) throw new CnfError("正文包含当前编辑器不支持的节点字段");
    if (node.attrs !== undefined && (!node.attrs || typeof node.attrs !== "object" || Array.isArray(node.attrs))) throw new CnfError("正文属性格式无效");
    for (const key of Object.keys((node.attrs ?? {}) as object)) {
      if (!Object.hasOwn(type.spec.attrs ?? {}, key)) throw new CnfError(`当前编辑器不支持 ${node.type} 属性：${key}，未导入任何内容`);
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new CnfError("正文子节点格式无效");
      node.content.forEach((child) => check(child));
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) throw new CnfError("正文标记格式无效");
      node.marks.forEach((mark) => check(mark, true));
    }
    if (node.type === "tableCell" || node.type === "tableHeader") {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      for (const key of ["colspan", "rowspan"]) {
        const span = attrs[key] ?? 1;
        if (typeof span !== "number" || !Number.isSafeInteger(span) || span < 1 || span > 1000) throw new CnfError("表格跨行／跨列属性无效或超过导入限制");
      }
      if (attrs.colwidth != null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.length !== (attrs.colspan ?? 1) || attrs.colwidth.some((width: unknown) => typeof width !== "number" || !Number.isFinite(width) || width < 0 || width > 100_000))) throw new CnfError("表格列宽属性无效");
    }
    if (node.type === "image") {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      if (typeof attrs?.src !== "string" || !/^assets\//.test(attrs.src)) throw new CnfError("CNF 图片必须包含在文件中，不能依赖外部地址");
    }
  };
  check(document);
  try { currentSchema.nodeFromJSON(document as JSONContent).check(); }
  catch { throw new CnfError("正文不符合当前编辑器结构，未导入任何内容"); }
}

export async function createCnfZip(entries: Map<string, Buffer>) {
  if ([...entries.values()].reduce((sum, bytes) => sum + bytes.length, 0) > CNF_LIMITS.expanded) throw new CnfError("笔记本解压体积不能超过 200 MB");
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  let size = 0;
  const result = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > CNF_LIMITS.compressed) { archive.abort(); reject(new CnfError("CNF 文件不能超过 100 MB")); }
      else chunks.push(chunk);
    });
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const [name, bytes] of entries) archive.append(bytes, { name });
  void archive.finalize().catch(() => undefined); // Errors are delivered through the archive event above.
  return result;
}

export async function parseCnf(buffer: Buffer) {
  if (buffer.length > CNF_LIMITS.compressed) throw new CnfError("CNF 文件不能超过 100 MB");
  let entries: Map<string, Buffer>;
  try { entries = await readZipEntries(buffer, CNF_LIMITS.expanded, CNF_LIMITS.expanded, CNF_LIMITS.entries); }
  catch { throw new CnfError("CNF 压缩结构损坏、路径不安全或超出解压限制"); }
  const json = (name: string) => {
    const bytes = entries.get(name);
    if (!bytes) throw new CnfError(`CNF 缺少 ${name}`);
    try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new CnfError(`CNF 的 ${name} 不是有效 JSON`); }
  };
  const manifestResult = cnfManifestSchema.safeParse(json("manifest.json"));
  const notebookResult = cnfNotebookSchema.safeParse(json("notebook.json"));
  if (!manifestResult.success) throw new CnfError("CNF 格式标识、版本或兼容信息不受支持");
  if (!notebookResult.success) throw new CnfError("CNF 笔记本数据或元信息无效");
  const manifest = manifestResult.data, notebook = notebookResult.data;
  if (manifest.notebookId !== notebook.id || manifest.pageCount !== notebook.pages.length || manifest.snapshotCount !== notebook.snapshots.length || manifest.notebookSha256 !== sha256(entries.get("notebook.json")!)) throw new CnfError("CNF 清单、校验和与正文不一致");
  const ids = new Set<string>(), paths = new Set<string>();
  for (const asset of manifest.assets) {
    if (ids.has(asset.id) || paths.has(asset.path)) throw new CnfError("CNF 包含重复资源");
    ids.add(asset.id); paths.add(asset.path);
    const bytes = entries.get(asset.path);
    if (!bytes || bytes.length !== asset.size || bytes.length > CNF_LIMITS.image || sha256(bytes) !== asset.sha256 || detectImage(bytes)?.mime !== asset.mimeType) throw new CnfError(`CNF 图片损坏或类型不匹配：${asset.originalName}`);
  }
  if (entries.size !== paths.size + 2 || [...entries.keys()].some((key) => !paths.has(key) && !["manifest.json", "notebook.json"].includes(key))) throw new CnfError("CNF 包含未声明的文件");
  const pageIds = new Set(notebook.pages.map((page) => page.id));
  if (pageIds.size !== notebook.pages.length || new Set(notebook.snapshots.map((snapshot) => snapshot.id)).size !== notebook.snapshots.length) throw new CnfError("CNF 包含重复页面或历史版本");
  if (notebook.coverAssetId && !ids.has(notebook.coverAssetId)) throw new CnfError("CNF 封面引用不存在");
  for (const page of [...notebook.pages, ...notebook.snapshots]) {
    if ("pageId" in page && !pageIds.has(page.pageId)) throw new CnfError("CNF 历史版本引用无效");
    mapDocumentAssets(page.content, (value, key) => {
      if (key === "assetId" && !ids.has(value)) throw new CnfError("CNF 正文资源引用不存在");
      if (/^assets\//.test(value) && !paths.has(value)) throw new CnfError("CNF 正文图片文件不存在");
      if (/^(?:https?:\/\/[^/]+)?\/uploads\/notes\//i.test(value)) throw new CnfError("CNF 仍包含服务器图片路径");
      return value;
    });
    validateEditableDocument(page.content);
    // assetId and src must resolve to the same resource.
    const checkImages = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const item = node as { type?: string; attrs?: { assetId?: string; src?: string }; content?: unknown[] };
      if (item.type === "image" && item.attrs?.assetId && manifest.assets.find((asset) => asset.id === item.attrs?.assetId)?.path !== item.attrs.src) throw new CnfError("CNF 图片标识与路径不一致");
      item.content?.forEach(checkImages);
    };
    checkImages(page.content);
  }
  return { manifest, notebook, entries };
}
