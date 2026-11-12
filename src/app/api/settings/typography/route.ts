import { z } from "zod";
import { db, nowIso } from "@/db";
import { userSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const schema = z.object({ uiFontSize: z.enum(["compact", "standard", "large"]) }).strict();

/** Own UI preference only; does not grant admin access to ordinary notebook APIs. */
export async function PATCH(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const session = await getSession();
    if (!session) return jsonError("请先登录", 401);
    if (session.mustChangePassword) return jsonError("请先修改密码", 403);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("界面字号无效");
    const updatedAt = nowIso();
    await db.insert(userSettings).values({ userId: session.userId, uiFontSize: parsed.data.uiFontSize, updatedAt })
      .onConflictDoUpdate({ target: userSettings.userId, set: { uiFontSize: parsed.data.uiFontSize, updatedAt } });
    return Response.json({ uiFontSize: parsed.data.uiFontSize });
  } catch {
    return jsonError("无法保存界面字号", 500);
  }
}
