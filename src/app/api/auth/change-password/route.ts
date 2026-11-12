import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clearSession, getSession, hashPassword } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const schema = z.object({
  password: z.string().min(10).max(128),
  confirmPassword: z.string()
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"], message: "两次输入的密码不一致"
});

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  const session = await getSession();
  if (!session) return jsonError("登录状态已失效，请重新登录", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "密码无效");
  const [updated] = await db.update(users).set({
    passwordHash: await hashPassword(parsed.data.password),
    mustChangePassword: false,
    sessionVersion: sql`${users.sessionVersion} + 1`
  }).where(and(eq(users.id, session.userId), eq(users.sessionVersion, session.sessionVersion))).returning({ role: users.role });
  if (!updated) return jsonError("登录状态已失效，请重新登录", 401);
  await clearSession();
  return Response.json({ ok: true, redirectTo: updated.role === "ADMIN" ? "/admin" : "/app" });
}
