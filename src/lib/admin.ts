import { db, nowIso } from "@/db";
import { adminAuditLogs } from "@/db/schema";

export async function audit(adminUserId: string, action: string, targetUserId?: string) {
  await db.insert(adminAuditLogs).values({
    id: crypto.randomUUID(), adminUserId, action, targetUserId: targetUserId ?? null, createdAt: nowIso()
  });
}
