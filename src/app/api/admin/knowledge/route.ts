import { z } from "zod";
import { requireAdmin, authError } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listAdminKnowledge } from "@/lib/admin-knowledge";
const schema = z.object({ q: z.string().max(200), status: z.enum(["active", "trash"]), page: z.coerce.number().int().positive().max(100000) });
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const parsed = schema.safeParse({ q: url.searchParams.get("q") ?? "", status: url.searchParams.get("status") ?? "active", page: url.searchParams.get("page") ?? "1" });
    if (!parsed.success) return jsonError("查询条件无效");
    return Response.json(listAdminKnowledge(parsed.data.q, parsed.data.status, parsed.data.page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError("无法读取知识库", authError(error)); }
}
