import { and, count, eq, isNull, sum, desc } from "drizzle-orm";
import { db } from "@/db";
import { assets, backupRecords, knowledgeEntries, notebooks, pages, users } from "@/db/schema";
import { requireAdmin, authError } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  try {
    await requireAdmin();
    const [userCount] = await db.select({ value: count() }).from(users).where(eq(users.role, "USER"));
    const [notebookCount] = await db.select({ value: count() }).from(notebooks).where(isNull(notebooks.deletedAt));
    const [pageCount] = await db.select({ value: count() }).from(pages)
      .innerJoin(notebooks, eq(pages.notebookId, notebooks.id))
      .where(and(isNull(pages.deletedAt), isNull(notebooks.deletedAt)));
    const [entryCount] = await db.select({ value: count() }).from(knowledgeEntries).where(isNull(knowledgeEntries.deletedAt));
    const [imageCount] = await db.select({ value: count() }).from(assets);
    const [storage] = await db.select({ value: sum(assets.size) }).from(assets);
    const latestBackup = (await db.select().from(backupRecords).orderBy(desc(backupRecords.createdAt)).limit(1))[0] ?? null;
    return Response.json({ users: userCount.value, notebooks: notebookCount.value, pages: pageCount.value, entries: entryCount.value, images: imageCount.value, storageBytes: Number(storage.value ?? 0), latestBackup });
  } catch (error) { return jsonError("无权访问", authError(error)); }
}
