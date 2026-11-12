import { requireAdmin, authError } from "@/lib/auth";
import { scanAssetInventory } from "@/lib/asset-cleanup";
import { audit } from "@/lib/admin";
import { jsonError } from "@/lib/http";

export async function GET() {
  try {
    const admin = await requireAdmin();
    const scan = scanAssetInventory({ limit: 0 });
    await audit(admin.userId, `asset.scan.summary ${JSON.stringify(scan.summary)}`);
    return Response.json({ summary: scan.summary, graceHours: scan.graceHours });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "无法扫描图片存储", authError(error));
  }
}
