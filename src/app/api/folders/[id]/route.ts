import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso, sqlite } from "@/db";
import { folders } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const patchSchema = z.object({ name: z.string().trim().min(1).max(80).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.name) return jsonError("请输入有效的文件夹名称");
    const [updated] = await db.update(folders).set({ name: parsed.data.name, updatedAt: nowIso() })
      .where(and(eq(folders.id, id), eq(folders.userId, userId))).returning();
    return updated ? Response.json({ folder: updated }) : jsonError("文件夹不存在", 404);
  } catch (error) { return jsonError("无法更新文件夹", authError(error)); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [folder] = await db.select().from(folders).where(and(eq(folders.id, id), eq(folders.userId, userId))).limit(1);
    if (!folder) return jsonError("文件夹不存在", 404);
    if (folder.isDefault) return jsonError("默认文件夹不能删除", 400);
    const [defaultFolder] = await db.select().from(folders).where(and(eq(folders.userId, userId), eq(folders.isDefault, true))).limit(1);
    if (!defaultFolder) return jsonError("默认文件夹不存在", 500);
    const now = nowIso();
    sqlite.transaction(() => {
      sqlite.prepare("UPDATE notebooks SET folder_id = ?, updated_at = ? WHERE folder_id = ? AND user_id = ?").run(defaultFolder.id, now, id, userId);
      sqlite.prepare("DELETE FROM folders WHERE id = ? AND user_id = ? AND is_default = 0").run(id, userId);
    })();
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法删除文件夹", authError(error)); }
}
