import { z } from "zod";
import { requireAdmin, authError } from "@/lib/auth";
import { scanAssetInventory } from "@/lib/asset-cleanup";
import { audit } from "@/lib/admin";
import { assertSameOrigin, jsonError } from "@/lib/http";

const querySchema = z.object({
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  userId: z.string().uuid().optional(),
  sortBy: z.enum(["uploadedAt", "size", "username"]).default("uploadedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  onlyOrphans: z.boolean().default(false)
});

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const admin = await requireAdmin();
    const parsed = querySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("扫描参数无效");
    const scan = scanAssetInventory(parsed.data);
    await audit(admin.userId, `asset.scan ${JSON.stringify({ summary: scan.summary, candidates: scan.totalCandidates })}`);
    return Response.json(scan);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "无法扫描图片存储", authError(error));
  }
}
