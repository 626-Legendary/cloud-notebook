import { clearSession } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    await clearSession();
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Retain the cookie on revocation failure so the same session can be retried.
    console.error("Unable to revoke the current session during logout", error);
    const response = jsonError("服务器暂时无法完成退出，请重试", 503);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
