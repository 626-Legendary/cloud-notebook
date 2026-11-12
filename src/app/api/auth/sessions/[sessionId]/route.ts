import { and, eq, isNull } from "drizzle-orm";
import { db, nowIso } from "@/db";
import { authSessions } from "@/db/schema";
import { clearSession, getSession } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function DELETE(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  const current = await getSession();
  if (!current) return jsonError("请先登录", 401);
  const { sessionId } = await context.params;
  const revokedAt = nowIso();
  const result = await db.update(authSessions).set({ revokedAt }).where(and(
    eq(authSessions.id, sessionId), eq(authSessions.userId, current.userId), isNull(authSessions.revokedAt)
  ));
  if (result.changes === 0) return jsonError("会话不存在或已退出", 404);
  if (sessionId === current.currentSessionId) await clearSession();
  return Response.json({ ok: true });
}
