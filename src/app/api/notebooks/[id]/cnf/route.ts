import { z } from "zod";
import { requireUser, authError } from "@/lib/auth";
import { exportNotebookCnf } from "@/lib/cnf";
import { CnfError } from "@/lib/cnf-format";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return jsonError("笔记本不存在", 404);
    const { bytes, filename } = await exportNotebookCnf(userId, id);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.cloud-notebook+zip",
      "Content-Disposition": `attachment; filename="notebook.cnf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    } });
  } catch (error) {
    if (error instanceof CnfError) return jsonError(error.message, error.status);
    const status = authError(error);
    if (status === 500) console.error("CNF export failed", error);
    return jsonError(status === 401 ? "请先登录" : "无法导出笔记本", status);
  }
}
