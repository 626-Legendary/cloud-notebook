import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso, sqlite } from "@/db";
import { folders, notebooks, pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const restoreSchema = z.object({ type: z.enum(["notebook", "page"]), id: z.string().uuid() });

export async function GET() {
  try {
    const { userId } = await requireUser();
    const deletedNotebooks = await db.select({
      id: notebooks.id, title: notebooks.title, deletedAt: notebooks.deletedAt,
      folderName: folders.name, folderId: folders.id
    }).from(notebooks).leftJoin(folders, eq(notebooks.folderId, folders.id))
      .where(and(eq(notebooks.userId, userId), isNotNull(notebooks.deletedAt)));
    const deletedPages = await db.select({
      id: pages.id, title: pages.title, deletedAt: pages.deletedAt,
      notebookId: notebooks.id, notebookTitle: notebooks.title,
      folderName: folders.name
    }).from(pages)
      .innerJoin(notebooks, eq(pages.notebookId, notebooks.id))
      .leftJoin(folders, eq(notebooks.folderId, folders.id))
      .where(and(eq(pages.userId, userId), isNotNull(pages.deletedAt), isNull(notebooks.deletedAt)));
    const remainingDays = (deletedAt: string) => Math.max(0, Math.ceil(
      (Date.parse(deletedAt) + 7 * 24 * 60 * 60_000 - Date.now()) / (24 * 60 * 60_000)
    ));
    const notebookItems = deletedNotebooks.flatMap((item) => typeof item.deletedAt === "string" ? [{
      ...item, deletedAt: item.deletedAt, type: "notebook" as const, remainingDays: remainingDays(item.deletedAt),
      originalLocation: item.folderName ?? "原文件夹已删除"
    }] : []);
    const pageItems = deletedPages.flatMap((item) => typeof item.deletedAt === "string" ? [{
      ...item, deletedAt: item.deletedAt, type: "page" as const, remainingDays: remainingDays(item.deletedAt),
      originalLocation: `${item.folderName ?? "文件夹"} / ${item.notebookTitle}`
    }] : []);
    const trash = [...notebookItems, ...pageItems].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return Response.json({ trash });
  } catch (error) { return jsonError("无法读取垃圾箱", authError(error)); }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const parsed = restoreSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("恢复参数无效");
    const retentionCutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const deletedAt = null;
    if (parsed.data.type === "notebook") {
      const [updated] = await db.update(notebooks).set({ deletedAt, updatedAt: nowIso() })
        .where(and(eq(notebooks.id, parsed.data.id), eq(notebooks.userId, userId), isNotNull(notebooks.deletedAt), sql`${notebooks.deletedAt} >= ${retentionCutoff}`)).returning({ id: notebooks.id });
      return updated ? Response.json({ ok: true }) : jsonError("回收站中的笔记本不存在", 404);
    }
    const [page] = await db.select({ id: pages.id, notebookId: pages.notebookId }).from(pages)
      .where(and(eq(pages.id, parsed.data.id), eq(pages.userId, userId), isNotNull(pages.deletedAt), sql`${pages.deletedAt} >= ${retentionCutoff}`)).limit(1);
    if (!page) return jsonError("回收站中的页面不存在", 404);
    const [parent] = await db.select({ id: notebooks.id }).from(notebooks)
      .where(and(eq(notebooks.id, page.notebookId), eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).limit(1);
    if (!parent) return jsonError("请先恢复所属笔记本，再恢复此页面", 409);
    await db.update(pages).set({ deletedAt }).where(eq(pages.id, page.id));
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法恢复项目", authError(error)); }
}

export async function DELETE(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const deletedAt = nowIso();
    const result = sqlite.transaction(() => {
      const notebooksResult = sqlite.prepare("DELETE FROM notebooks WHERE user_id = ? AND deleted_at IS NOT NULL").run(userId);
      const pagesResult = sqlite.prepare(`
        DELETE FROM pages WHERE user_id = ? AND deleted_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = pages.notebook_id AND notebooks.deleted_at IS NULL)
      `).run(userId);
      return notebooksResult.changes + pagesResult.changes;
    }).immediate();
    return Response.json({ deleted: result, at: deletedAt });
  } catch (error) { return jsonError("无法清空垃圾箱", authError(error)); }
}
