import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso } from "@/db";
import { noteSnapshots, pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const schema = z.object({ snapshotId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("历史版本无效");
    const [page] = await db.select().from(pages).where(and(
      eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    const [snapshot] = await db.select().from(noteSnapshots).where(and(
      eq(noteSnapshots.id, parsed.data.snapshotId), eq(noteSnapshots.pageId, id), eq(noteSnapshots.userId, userId),
      sql`EXISTS (SELECT 1 FROM pages INNER JOIN notebooks ON notebooks.id = pages.notebook_id WHERE pages.id = ${id} AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL)`
    )).limit(1);
    if (!page || !snapshot) return jsonError("页面或历史版本不存在", 404);
    const now = nowIso();
    await db.insert(noteSnapshots).values({ id: crypto.randomUUID(), userId, pageId: id, title: page.title, content: page.content, createdAt: now });
    const [restored] = await db.update(pages).set({
      title: snapshot.title, content: snapshot.content, version: page.version + 1, updatedAt: now
    }).where(and(
      eq(pages.id, id), eq(pages.userId, userId), eq(pages.version, page.version), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    )).returning();
    if (!restored) return jsonError("页面已发生变化，请刷新后重试", 409);
    return Response.json({ page: restored });
  } catch (error) { return jsonError("恢复历史版本失败", authError(error)); }
}
