import { authError } from "@/lib/auth";
import { KnowledgeError } from "@/lib/knowledge";
export function knowledgeResponseError(error: unknown) {
  if (error instanceof KnowledgeError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  const status = authError(error);
  return Response.json({ error: status === 401 ? "请先登录" : status === 403 ? "没有权限" : "操作失败，请稍后重试" }, { status });
}

export async function readKnowledgeJson(request: Request, limit = 2_100_000): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit) throw new KnowledgeError("请求内容过大", 413);
  const reader = request.body?.getReader(); if (!reader) throw new KnowledgeError("请求内容无效");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new KnowledgeError("请求内容过大", 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new KnowledgeError("请求 JSON 无效"); }
}
