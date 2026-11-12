import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/admin";
import { hashPassword, requireAdmin, authError } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.role, "USER"))).limit(1);
    if (!user) return jsonError("用户不存在", 404);
    const temporaryPassword = randomBytes(18).toString("base64url");
    await db.update(users).set({
      passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true,
      sessionVersion: sql`${users.sessionVersion} + 1`
    }).where(eq(users.id, id));
    await audit(admin.userId, "user.password.reset", id);
    return Response.json({ temporaryPassword });
  } catch (error) { return jsonError("无法重置密码", authError(error)); }
}
