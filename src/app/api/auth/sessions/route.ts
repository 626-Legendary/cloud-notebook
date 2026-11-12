import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { db, nowIso } from "@/db";
import { authSessions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("请先登录", 401);
  const now = nowIso();
  const sessions = await db.select({
    id: authSessions.id,
    deviceLabel: authSessions.deviceLabel,
    createdAt: authSessions.createdAt,
    lastActiveAt: authSessions.lastActiveAt,
    expiresAt: authSessions.expiresAt
  }).from(authSessions).where(and(
    eq(authSessions.userId, session.userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now)
  )).orderBy(desc(authSessions.lastActiveAt));
  return Response.json({
    sessions: sessions.map((item) => ({ ...item, current: item.id === session.currentSessionId })),
    activeCount: sessions.length
  });
}

export async function DELETE(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  const session = await getSession();
  if (!session) return jsonError("请先登录", 401);
  const revokedAt = nowIso();
  const result = await db.update(authSessions).set({ revokedAt }).where(and(
    eq(authSessions.userId, session.userId), isNull(authSessions.revokedAt),
    gt(authSessions.expiresAt, revokedAt), ne(authSessions.id, session.currentSessionId)
  ));
  return Response.json({ revoked: result.changes });
}
