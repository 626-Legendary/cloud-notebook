import { z } from "zod";
import { requireAdmin, authError } from "@/lib/auth";
import { scanAssetInventory } from "@/lib/asset-cleanup";
import { jsonError } from "@/lib/http";

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  userId: z.string().uuid().optional(),
  sortBy: z.enum(["uploadedAt", "size", "username"]).default("uploadedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  onlyOrphans: z.enum(["true", "false"]).default("true")
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      offset: url.searchParams.get("offset") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      sortBy: url.searchParams.get("sortBy") ?? undefined,
      direction: url.searchParams.get("direction") ?? undefined,
      onlyOrphans: url.searchParams.get("onlyOrphans") ?? undefined
    });
    if (!parsed.success) return jsonError("候选列表参数无效");
    return Response.json(scanAssetInventory({ ...parsed.data, onlyOrphans: parsed.data.onlyOrphans === "true" }));
  } catch (error) {
    return jsonError("无权访问图片清理数据", authError(error));
  }
}
