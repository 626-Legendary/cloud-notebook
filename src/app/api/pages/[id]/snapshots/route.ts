import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { noteSnapshots, pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [page] = await db.select({ id: pages.id }).from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    if (!page) return jsonError("页面不存在", 404);
    const snapshots = await db.select({
      id: noteSnapshots.id, title: noteSnapshots.title, createdAt: noteSnapshots.createdAt
    }).from(noteSnapshots).where(and(eq(noteSnapshots.pageId, id), eq(noteSnapshots.userId, userId))).orderBy(desc(noteSnapshots.createdAt));
    return Response.json({ snapshots });
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [page] = await db.select({ id: pages.id }).from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    if (!page) return jsonError("页面不存在", 404);
    await db.delete(noteSnapshots).where(and(eq(noteSnapshots.pageId, id), eq(noteSnapshots.userId, userId)));
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法清空历史记录", authError(error)); }
}
