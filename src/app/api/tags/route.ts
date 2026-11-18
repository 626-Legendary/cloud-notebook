import { requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { ownSource, sourceTags } from "@/lib/knowledge";
import { applyTagAction, listTags, tagActionSchema } from "@/lib/tags";
import { knowledgeResponseError, readKnowledgeJson } from "@/lib/knowledge-http";
export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(); const url = new URL(request.url), id = url.searchParams.get("sourceId"), kind = url.searchParams.get("sourceType");
    if (id && (kind === "page" || kind === "entry")) { ownSource(userId, kind, id); return Response.json({ tags: listTags(userId), selected: sourceTags(userId, kind, id) }); }
    return Response.json({ tags: listTags(userId) });
  } catch (error) { return knowledgeResponseError(error); }
}
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try { const { userId } = await requireUser(); const parsed = tagActionSchema.safeParse(await readKnowledgeJson(request)); if (!parsed.success) return jsonError("标签操作无效"); return Response.json(applyTagAction(userId, parsed.data)); }
  catch (error) { return knowledgeResponseError(error); }
}
