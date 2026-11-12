import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso, sqlite } from "@/db";
import { pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const docSchema = z.object({ type: z.literal("doc"), content: z.array(z.record(z.unknown())).optional() });
const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.union([z.string().max(2_000_000), docSchema]).optional(),
  version: z.number().int().positive(),
  preserveCurrentVersion: z.boolean().optional()
}).refine((value) => value.title !== undefined || value.content !== undefined);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [page] = await db.select().from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    return page ? Response.json({ page }) : jsonError("页面不存在", 404);
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("页面内容无效");
    const [current] = await db.select().from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    if (!current) return jsonError("页面不存在", 404);
    if (current.version !== parsed.data.version) return Response.json({ error: "此页面已在其他位置更新，请先解决版本冲突", currentVersion: current.version }, { status: 409 });
    const content = parsed.data.content === undefined ? current.content : typeof parsed.data.content === "string" ? parsed.data.content : JSON.stringify(parsed.data.content);
    let document: unknown;
    try { document = JSON.parse(content); } catch { return jsonError("正文不是有效的编辑器文档"); }
    const validDoc = docSchema.safeParse(document);
    if (!validDoc.success) return jsonError("正文格式无效");
    const referencedAssets = collectAssetIds(document);
    const title = parsed.data.title ?? current.title;
    const now = nowIso();
    const saveResult = sqlite.transaction(() => {
      const latest = sqlite.prepare(`
        SELECT id, user_id AS userId, notebook_id AS notebookId, title, content,
               sort_order AS sortOrder, version, created_at AS createdAt, updated_at AS updatedAt
        FROM pages WHERE id = ? AND user_id = ? AND deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = pages.notebook_id AND notebooks.deleted_at IS NULL)
      `).get(id, userId) as typeof current | undefined;
      if (!latest) return { error: "missing" as const };
      if (latest.version !== parsed.data.version) return { error: "conflict" as const, version: latest.version };
      if (title === latest.title && content === latest.content) return { page: latest };
      const ownsAsset = sqlite.prepare("SELECT 1 FROM assets WHERE id = ? AND user_id = ?");
      for (const assetId of referencedAssets) {
        if (!ownsAsset.get(assetId, userId)) return { error: "asset" as const };
      }
      const lastSnapshot = sqlite.prepare(`
        SELECT title, content, created_at AS createdAt FROM note_snapshots
        WHERE page_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(id, userId) as { title: string; content: string; createdAt: string } | undefined;
      const currentVersionNotSnapshotted = !lastSnapshot ||
        lastSnapshot.title !== latest.title || lastSnapshot.content !== latest.content;
      if (currentVersionNotSnapshotted && (parsed.data.preserveCurrentVersion ||
        !lastSnapshot || Date.now() - Date.parse(lastSnapshot.createdAt) >= 60_000)) {
        sqlite.prepare("INSERT INTO note_snapshots (id, user_id, page_id, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), userId, id, latest.title, latest.content, now);
      }
      sqlite.prepare("UPDATE pages SET title = ?, content = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(title, content, now, id, userId);
      const updated = sqlite.prepare(`
        SELECT id, user_id AS userId, notebook_id AS notebookId, title, content,
               sort_order AS sortOrder, version, created_at AS createdAt, updated_at AS updatedAt
        FROM pages WHERE id = ? AND user_id = ?
      `).get(id, userId);
      return { page: updated };
    }).immediate();
    if ("error" in saveResult) {
      if (saveResult.error === "conflict") return Response.json({ error: "此页面已在其他位置更新，请先解决版本冲突", currentVersion: saveResult.version }, { status: 409 });
      if (saveResult.error === "asset") return jsonError("正文引用了无权访问的图片", 403);
      return jsonError("页面不存在", 404);
    }
    return Response.json({ page: saveResult.page });
  } catch (error) { return jsonError("保存失败，请稍后重试", authError(error)); }
}

function collectAssetIds(value: unknown, ids = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIds(item, ids);
  } else if (value && typeof value === "object") {
    const item = value as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (item.type === "image" && item.attrs) {
      const assetId = typeof item.attrs.assetId === "string"
        ? item.attrs.assetId
        : typeof item.attrs.src === "string" ? /^\/uploads\/notes\/([0-9a-f-]{36})$/i.exec(item.attrs.src)?.[1] : undefined;
      if (assetId) ids.add(assetId);
    }
    if (item.content) collectAssetIds(item.content, ids);
  }
  return ids;
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [row] = await db.select({ id: pages.id }).from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    if (!row) return jsonError("页面不存在", 404);
    sqlite.prepare("UPDATE pages SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").run(nowIso(), id, userId);
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法删除页面", authError(error)); }
}
