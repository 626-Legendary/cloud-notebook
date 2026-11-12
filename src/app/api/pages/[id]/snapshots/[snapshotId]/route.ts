import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { noteSnapshots, pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const { userId } = await requireUser();
    const { id, snapshotId } = await context.params;
    const [page] = await db.select({ id: pages.id }).from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), sql`${pages.deletedAt} IS NULL`,
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    if (!page) return jsonError("页面不存在", 404);
    const [snapshot] = await db.select().from(noteSnapshots).where(and(
      eq(noteSnapshots.id, snapshotId), eq(noteSnapshots.pageId, id), eq(noteSnapshots.userId, userId)
    )).limit(1);
    return snapshot ? Response.json({ snapshot }) : jsonError("历史版本不存在", 404);
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; snapshotId: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id, snapshotId } = await context.params;
    const [page] = await db.select({ id: pages.id }).from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), sql`${pages.deletedAt} IS NULL`,
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    if (!page) return jsonError("页面不存在", 404);
    const result = await db.delete(noteSnapshots).where(and(
      eq(noteSnapshots.id, snapshotId), eq(noteSnapshots.pageId, id), eq(noteSnapshots.userId, userId)
    )).returning({ id: noteSnapshots.id });
    return result.length ? Response.json({ ok: true }) : jsonError("历史版本不存在", 404);
  } catch (error) { return jsonError("无法删除历史版本", authError(error)); }
}
