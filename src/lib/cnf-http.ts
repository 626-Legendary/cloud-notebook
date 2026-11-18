import { requireUser, authError } from "@/lib/auth";
import { CnfError } from "@/lib/cnf-format";
import { jsonError } from "@/lib/http";
export async function cnfDownload(exporter: (userId: string) => Promise<{ bytes: Buffer; filename: string }>) {
  try {
    const { userId } = await requireUser(); const { bytes, filename } = await exporter(userId);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.cloud-notebook+zip", "Content-Disposition": `attachment; filename="export.cnf"; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { if (error instanceof CnfError) return jsonError(error.message, error.status); return jsonError("导出失败", authError(error)); }
}
