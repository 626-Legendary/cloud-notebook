import { exportKnowledgeCnf } from "@/lib/cnf";
import { cnfDownload } from "@/lib/cnf-http";
export const runtime = "nodejs";
export function GET() { return cnfDownload(exportKnowledgeCnf); }
