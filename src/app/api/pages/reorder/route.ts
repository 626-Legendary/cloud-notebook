import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, sqlite } from "@/db";
import { notebooks, pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const schema = z.object({ notebookId: z.string().uuid(), pageIds: z.array(z.string().uuid()).max(500) });

export async function PATCH(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || new Set(parsed.data.pageIds).size !== parsed.data.pageIds.length) return jsonError("排序数据无效");
    const [notebook] = await db.select({ id: notebooks.id }).from(notebooks).where(and(
      eq(notebooks.id, parsed.data.notebookId), eq(notebooks.userId, userId), isNull(notebooks.deletedAt)
    )).limit(1);
    if (!notebook) return jsonError("笔记本不存在", 404);
    const existing = await db.select({ id: pages.id }).from(pages).where(and(
      eq(pages.userId, userId), eq(pages.notebookId, parsed.data.notebookId), isNull(pages.deletedAt),
      sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
    ));
    const allowed = new Set(existing.map((page) => page.id));
    if (parsed.data.pageIds.some((id) => !allowed.has(id)) || parsed.data.pageIds.length !== existing.length) return jsonError("页面归属校验失败", 403);
    sqlite.transaction(() => {
      for (const [sortOrder, id] of parsed.data.pageIds.entries()) {
        sqlite.prepare("UPDATE pages SET sort_order = ? WHERE id = ? AND user_id = ?").run(sortOrder, id, userId);
      }
    })();
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法保存页面顺序", authError(error)); }
}
