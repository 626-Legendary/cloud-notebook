import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, nowIso, sqlite } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { getRegistrationEnabled } from "@/lib/system-settings";

const inputSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[\p{L}\p{N}_.-]+$/u),
  password: z.string().min(10).max(128),
  confirmPassword: z.string()
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"], message: "两次输入的密码不一致"
});

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  const registrationEnabled = await getRegistrationEnabled();
  if (!registrationEnabled) return jsonError("当前已关闭新用户注册", 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "输入内容无效");
  const { username, password } = parsed.data;
  const normalizedUsername = username.trim();
  if (normalizedUsername.toLowerCase() === (process.env.ADMIN_USERNAME ?? "admin").toLowerCase()) return jsonError("该用户名不可用");
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`LOWER(${users.username}) = LOWER(${normalizedUsername})`).limit(1);
  if (existing) return jsonError("该用户名已被使用", 409);

  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    const passwordHash = await hashPassword(password);
    sqlite.transaction(() => {
      sqlite.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'USER', ?)").run(id, username, passwordHash, now);
      sqlite.prepare("INSERT INTO folders (id, user_id, name, is_default, sort_order, created_at, updated_at) VALUES (?, ?, '默认文件夹', 1, 0, ?, ?)").run(crypto.randomUUID(), id, now, now);
      sqlite.prepare("INSERT INTO user_settings (user_id, theme, auto_save_mode, updated_at) VALUES (?, 'system', 'realtime', ?)").run(id, now);
    })();
    const [user] = await db.select().from(users).where(and(eq(users.id, id), eq(users.role, "USER"))).limit(1);
    if (!user) return jsonError("注册失败，请稍后重试", 500);
    await createSession(user, request);
    return Response.json({ user: { id: user.id, username: user.username, role: user.role } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) return jsonError("该用户名已被使用", 409);
    console.error("Registration failed", error);
    return jsonError("注册失败，请稍后重试", 500);
  }
}
