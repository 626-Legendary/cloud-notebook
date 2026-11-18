import { exportPageCnf } from "@/lib/cnf";
import { cnfDownload } from "@/lib/cnf-http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return cnfDownload((userId) => exportPageCnf(userId, id));
}
