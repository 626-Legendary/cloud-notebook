import { requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { repairReference, repairReferenceSchema } from "@/lib/knowledge";
import { knowledgeResponseError, readKnowledgeJson } from "@/lib/knowledge-http";
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try { const { userId } = await requireUser(); const parsed = repairReferenceSchema.safeParse(await readKnowledgeJson(request)); if (!parsed.success) return jsonError("请选择有效的引用位置和一种修复方式"); return Response.json(repairReference(userId, parsed.data)); }
  catch (error) { return knowledgeResponseError(error); }
}
