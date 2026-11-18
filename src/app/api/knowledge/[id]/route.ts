import { requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { backlinks, deleteEntry, entryUpdateSchema, getEntry, updateEntry } from "@/lib/knowledge";
import { knowledgeResponseError, readKnowledgeJson } from "@/lib/knowledge-http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { const { userId } = await requireUser(); const { id } = await context.params; return Response.json({ entry: getEntry(userId, id), backlinks: backlinks(userId, id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return knowledgeResponseError(error); }
}
export async function PATCH(request: Request, context: Context) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser(); const { id } = await context.params; const parsed = entryUpdateSchema.safeParse(await readKnowledgeJson(request));
    if (!parsed.success) return jsonError("词条内容或版本无效");
    return Response.json({ page: updateEntry(userId, id, parsed.data) });
  } catch (error) { return knowledgeResponseError(error); }
}
export async function DELETE(request: Request, context: Context) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try { const { userId } = await requireUser(); const { id } = await context.params; deleteEntry(userId, id); return Response.json({ ok: true }); }
  catch (error) { return knowledgeResponseError(error); }
}
