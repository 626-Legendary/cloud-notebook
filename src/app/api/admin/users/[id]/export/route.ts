import { and, eq } from "drizzle-orm";
import { Readable } from "node:stream";
import { db } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/admin";
import { createUserExport } from "@/lib/export";
import { requireAdmin, authError } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const [user] = await db.select({ username: users.username }).from(users).where(and(eq(users.id, id), eq(users.role, "USER"))).limit(1);
    if (!user) return jsonError("用户不存在", 404);
    await audit(admin.userId, "user.data.export", id);
    const stream = await createUserExport(id);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="user-backup-${encodeURIComponent(user.username)}.zip"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("User data export failed", error);
    return jsonError("导出用户数据失败", authError(error));
  }
}
