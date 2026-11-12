import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, sqlite } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin, authError } from "@/lib/auth";
import path from "node:path";
import { deleteManagedUser, UserDeletionError } from "@/lib/admin-user-deletion";
import { assertSameOrigin, jsonError } from "@/lib/http";

const updateSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[\p{L}\p{N}_.-]+$/u, "用户名只能包含字母、数字、下划线、点和减号")
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const user = sqlite.prepare(`
      SELECT users.id, users.username, users.created_at AS createdAt,
        (SELECT COUNT(*) FROM notebooks WHERE notebooks.user_id = users.id AND notebooks.deleted_at IS NULL) AS notebookCount,
        (SELECT COUNT(*) FROM pages INNER JOIN notebooks ON notebooks.id = pages.notebook_id
          WHERE pages.user_id = users.id AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL) AS pageCount,
        (SELECT COUNT(*) FROM assets WHERE assets.user_id = users.id) AS imageCount,
        (SELECT COALESCE(SUM(size), 0) FROM assets WHERE assets.user_id = users.id) AS storageBytes
      FROM users WHERE users.id = ? AND users.role = 'USER'
    `).get(id) as {
      id: string; username: string; createdAt: string; notebookCount: number;
      pageCount: number; imageCount: number; storageBytes: number
    } | undefined;
    return user ? Response.json({ user }) : jsonError("用户不存在", 404);
  } catch (error) { return jsonError("无权访问", authError(error)); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    await requireAdmin();
    const { id } = await context.params;
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "用户名无效", 400);
    const username = parsed.data.username;
    if (username.toLowerCase() === (process.env.ADMIN_USERNAME ?? "admin").toLowerCase()) return jsonError("该用户名不可用", 409);
    const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "USER"), sql`LOWER(${users.username}) = LOWER(${username})`, sql`${users.id} != ${id}`)).limit(1);
    if (existing) return jsonError("该用户名已被使用", 409);
    const [updated] = await db.update(users).set({ username }).where(and(eq(users.id, id), eq(users.role, "USER"))).returning({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt });
    if (!updated) return jsonError("用户不存在", 404);
    return Response.json({ user: updated });
  } catch (error) { return jsonError("无法修改用户名", authError(error)); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return jsonError("用户 ID 无效");
    return Response.json(deleteManagedUser(sqlite, path.resolve(process.cwd(), "data/uploads/notes"), admin.userId, id));
  } catch (error) {
    return jsonError(error instanceof UserDeletionError ? error.message : "无法删除用户", error instanceof UserDeletionError ? error.status : authError(error));
  }
}
