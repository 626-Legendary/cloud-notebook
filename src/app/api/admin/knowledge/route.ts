import { requireAdmin, authError } from "@/lib/auth";
import { jsonError } from "@/lib/http";
export async function GET() { try { await requireAdmin(); return jsonError("此功能已移除",404); } catch(error) { return jsonError("无权访问",authError(error)); } }
