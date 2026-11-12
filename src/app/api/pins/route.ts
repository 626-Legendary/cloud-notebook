import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso } from "@/db";
import { notebooks, pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const pinSchema = z.object({ type: z.enum(["notebook", "page"]), id: z.string().uuid() });

export async function GET() {
  try {
    const { userId } = await requireUser();
    const [pinnedNotebooks, pinnedPages] = await Promise.all([
      db.select({ id: notebooks.id, title: notebooks.title, pinnedAt: notebooks.pinnedAt, pinSortOrder: notebooks.pinSortOrder })
        .from(notebooks).where(and(eq(notebooks.userId, userId), isNull(notebooks.deletedAt)))
        .orderBy(asc(notebooks.pinSortOrder)),
      db.select({
        id: pages.id, title: pages.title, notebookId: pages.notebookId, notebookTitle: notebooks.title,
        pinnedAt: pages.pinnedAt, pinSortOrder: pages.pinSortOrder
      }).from(pages).innerJoin(notebooks, eq(pages.notebookId, notebooks.id))
        .where(and(eq(pages.userId, userId), isNull(pages.deletedAt), isNull(notebooks.deletedAt)))
        .orderBy(asc(pages.pinSortOrder))
    ]);
    return Response.json({
      pins: [
        ...pinnedNotebooks.filter((item) => item.pinnedAt).map((item) => ({ ...item, type: "notebook" as const })),
        ...pinnedPages.filter((item) => item.pinnedAt).map((item) => ({ ...item, type: "page" as const }))
      ].sort((a, b) => a.pinSortOrder - b.pinSortOrder)
    });
  } catch (error) { return jsonError("无法读取置顶项目", authError(error)); }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const parsed = pinSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("置顶参数无效");
    const pinnedAt = nowIso();
    if (parsed.data.type === "notebook") {
      const [updated] = await db.update(notebooks).set({ pinnedAt, pinSortOrder: Date.now() })
        .where(and(eq(notebooks.id, parsed.data.id), eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).returning({ id: notebooks.id });
      return updated ? Response.json({ ok: true }) : jsonError("笔记本不存在", 404);
    }
    const [updated] = await db.update(pages).set({ pinnedAt, pinSortOrder: Date.now() })
      .where(and(
        eq(pages.id, parsed.data.id), eq(pages.userId, userId), isNull(pages.deletedAt),
        sql`EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = ${pages.notebookId} AND notebooks.deleted_at IS NULL)`
      )).returning({ id: pages.id });
    return updated ? Response.json({ ok: true }) : jsonError("页面不存在", 404);
  } catch (error) { return jsonError("无法置顶项目", authError(error)); }
}

export async function DELETE(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const parsed = pinSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("取消置顶参数无效");
    if (parsed.data.type === "notebook") {
      await db.update(notebooks).set({ pinnedAt: null })
        .where(and(eq(notebooks.id, parsed.data.id), eq(notebooks.userId, userId)));
    } else {
      await db.update(pages).set({ pinnedAt: null })
        .where(and(eq(pages.id, parsed.data.id), eq(pages.userId, userId)));
    }
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法取消置顶", authError(error)); }
}
