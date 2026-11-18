import { requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { checkReferences } from "@/lib/knowledge";
import { knowledgeResponseError } from "@/lib/knowledge-http";
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try { const { userId } = await requireUser(); return Response.json(checkReferences(userId)); }
  catch (error) { return knowledgeResponseError(error); }
}
