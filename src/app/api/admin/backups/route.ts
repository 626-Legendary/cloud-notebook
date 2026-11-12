import { asc } from "drizzle-orm";
import { db } from "@/db";
import { backupRecords } from "@/db/schema";
import { audit } from "@/lib/admin";
import { applyBackupRetention, createSystemBackup } from "@/lib/backups";
import { requireAdmin, authError } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ backups: await db.select().from(backupRecords).orderBy(asc(backupRecords.createdAt)) });
  } catch (error) { return jsonError("无权访问", authError(error)); }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const admin = await requireAdmin();
    const record = await createSystemBackup();
    await applyBackupRetention();
    await audit(admin.userId, "backup.create");
    return Response.json({ backup: record }, { status: 201 });
  } catch (error) {
    console.error("Manual backup failed", error);
    return jsonError("创建备份失败", authError(error));
  }
}
