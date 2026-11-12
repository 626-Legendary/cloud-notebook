import { and, eq, isNull } from "drizzle-orm";
import { db, nowIso } from "@/db";
import { assets, folders, notebooks } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { notebookPatchSchema } from "@/lib/notebook-update";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [notebook] = await db.select().from(notebooks).where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).limit(1);
    return notebook ? Response.json({ notebook }) : jsonError("笔记本不存在", 404);
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const parsed = notebookPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0) return jsonError("更新内容无效");
    if (parsed.data.folderId) {
      const [folder] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, parsed.data.folderId), eq(folders.userId, userId))).limit(1);
      if (!folder) return jsonError("目标文件夹不存在", 404);
    }
    if (parsed.data.coverAssetId) {
      const [asset] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, parsed.data.coverAssetId), eq(assets.userId, userId))).limit(1);
      if (!asset) return jsonError("封面图片不存在", 404);
    }
    const [updated] = await db.update(notebooks).set({ ...parsed.data, updatedAt: nowIso() })
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).returning();
    return updated ? Response.json({ notebook: updated }) : jsonError("笔记本不存在", 404);
  } catch (error) { return jsonError("无法更新笔记本", authError(error)); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [row] = await db.select({ id: notebooks.id }).from(notebooks).where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).limit(1);
    if (!row) return jsonError("笔记本不存在", 404);
    await db.update(notebooks).set({ deletedAt: nowIso() })
      .where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), isNull(notebooks.deletedAt)));
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法删除笔记本", authError(error)); }
}
