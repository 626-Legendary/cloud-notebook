import { z } from "zod";
import { requireAdmin, authError } from "@/lib/auth";
import { cleanupOrphanAssets } from "@/lib/asset-cleanup";
import { assertSameOrigin, jsonError } from "@/lib/http";

const bodySchema = z.object({ assetIds: z.array(z.string().uuid()).max(100) });

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const admin = await requireAdmin();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("清理参数无效");
    const result = cleanupOrphanAssets(admin.userId, parsed.data.assetIds);
    return Response.json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "图片清理失败", authError(error));
  }
}
