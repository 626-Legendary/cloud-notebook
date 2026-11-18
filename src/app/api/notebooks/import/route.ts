import { requireUser, authError } from "@/lib/auth";
import { importNotebookCnf } from "@/lib/cnf";
import { CnfError, CNF_LIMITS } from "@/lib/cnf-format";
import { assertSameOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const length = Number(request.headers.get("content-length"));
    if (length > CNF_LIMITS.compressed + 64 * 1024) return jsonError("CNF 文件不能超过 100 MB", 413);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) return jsonError("请使用文件上传表单");
    const reader = request.body?.getReader();
    if (!reader) return jsonError("请选择 .cnf 笔记本文件");
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > CNF_LIMITS.compressed + 64 * 1024) {
          await reader.cancel();
          throw new CnfError("CNF 文件不能超过 100 MB", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let form: FormData;
    try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
    catch { return jsonError("文件上传表单损坏"); }
    const file = form.get("file");
    if (!(file instanceof File) || !/\.cnf$/i.test(file.name)) return jsonError("请选择 .cnf 笔记本文件");
    if (!file.size || file.size > CNF_LIMITS.compressed) return jsonError("CNF 文件必须为 1 字节至 100 MB", 413);
    const notebook = await importNotebookCnf(userId, Buffer.from(await file.arrayBuffer()), form.get("reuseExisting") === "true");
    return Response.json({ notebook }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CnfError) return jsonError(error.message, error.status);
    const status = authError(error);
    if (status === 500) console.error("CNF import failed", error);
    return jsonError(status === 401 ? "请先登录" : "无法导入笔记本，文件未保存，请重试", status);
  }
}
