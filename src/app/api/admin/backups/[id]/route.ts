import fs from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backupRecords } from "@/db/schema";
import { audit } from "@/lib/admin";
import { requireAdmin, authError } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const [record] = await db.select().from(backupRecords).where(eq(backupRecords.id, id)).limit(1);
    if (!record) return jsonError("备份不存在", 404);
    const bytes = await fs.readFile(record.storagePath);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${record.filename}"`, "Cache-Control": "no-store" }
    });
  } catch (error) { return jsonError("下载备份失败", authError(error)); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const [record] = await db.select().from(backupRecords).where(eq(backupRecords.id, id)).limit(1);
    if (!record) return jsonError("备份不存在", 404);
    await fs.rm(record.storagePath, { force: true });
    await db.delete(backupRecords).where(and(eq(backupRecords.id, id)));
    await audit(admin.userId, "backup.delete");
    return Response.json({ ok: true });
  } catch (error) { return jsonError("无法删除备份", authError(error)); }
}
