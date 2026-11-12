import { z } from "zod";
import { audit } from "@/lib/admin";
import { authError, requireAdmin } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { restoreUserArchive } from "@/lib/restore";

const userIdSchema = z.string().uuid();
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const admin = await requireAdmin();
    const form = await request.formData();
    const parsedUserId = userIdSchema.safeParse(form.get("userId"));
    const file = form.get("file");
    if (!parsedUserId.success || !(file instanceof File) || !file.name.toLowerCase().endsWith(".zip")) return jsonError("请选择有效的 ZIP 备份文件");
    if (file.size === 0 || file.size > 100 * 1024 * 1024) return jsonError("备份文件大小必须小于 100 MB");
    const restored = await restoreUserArchive(parsedUserId.data, Buffer.from(await file.arrayBuffer()));
    await audit(admin.userId, "user.data.restore", parsedUserId.data);
    return Response.json({ restored });
  } catch (error) {
    console.error("User data restore failed", error);
    if (error instanceof z.ZodError) return jsonError("备份数据结构无效");
    if (error instanceof Error && !["UNAUTHORIZED", "FORBIDDEN"].includes(error.message)) return jsonError(error.message, 400);
    return jsonError("无权恢复用户数据", authError(error));
  }
}
