import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "请先登录" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const [user] = await db.select({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt, mustChangePassword: users.mustChangePassword })
    .from(users).where(eq(users.id, session.userId)).limit(1);
  return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
}
