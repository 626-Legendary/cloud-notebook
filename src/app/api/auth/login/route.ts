import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, verifyPassword } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const attempts = new Map<string, { count: number; startedAt: number }>();
const schema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const state = attempts.get(address);
  if (state && now - state.startedAt < 15 * 60_000 && state.count >= 10) return jsonError("尝试次数过多，请稍后再试", 429);
  if (!state || now - state.startedAt >= 15 * 60_000) attempts.set(address, { count: 1, startedAt: now });
  else state.count += 1;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("用户名或密码错误", 401);
  const [user] = await db.select().from(users).where(sql`LOWER(${users.username}) = LOWER(${parsed.data.username})`).limit(1);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return jsonError("用户名或密码错误", 401);
  await createSession(user, request);
  attempts.delete(address);
  return Response.json({
    user: { id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword },
    redirectTo: user.mustChangePassword ? "/change-password" : user.role === "ADMIN" ? "/admin" : "/app"
  });
}
