import { requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { createEntry, entryCreateSchema, listEntries } from "@/lib/knowledge";
import { knowledgeResponseError, readKnowledgeJson } from "@/lib/knowledge-http";
export async function GET(request: Request) {
  try { const { userId } = await requireUser(); const url = new URL(request.url); return Response.json({ entries: listEntries(userId, (url.searchParams.get("q") ?? "").slice(0, 200), url.searchParams.get("sort") ?? "updated", url.searchParams.get("catalog") === "1") }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return knowledgeResponseError(error); }
}
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser(); const parsed = entryCreateSchema.safeParse(await readKnowledgeJson(request));
    if (!parsed.success) return jsonError("词条名称、别名或正文无效");
    return Response.json({ entry: createEntry(userId, parsed.data) }, { status: 201 });
  } catch (error) { return knowledgeResponseError(error); }
}
