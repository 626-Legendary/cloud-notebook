import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso } from "@/db";
import { folders, notebooks } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  folderId: z.string().uuid().optional()
});

export async function GET() {
  try {
    const { userId } = await requireUser();
    const rows = await db.select({
      id: notebooks.id, userId: notebooks.userId, folderId: notebooks.folderId,
      title: notebooks.title, coverAssetId: notebooks.coverAssetId,
      sortOrder: notebooks.sortOrder, pinnedAt: notebooks.pinnedAt, pinSortOrder: notebooks.pinSortOrder,
      createdAt: notebooks.createdAt, updatedAt: notebooks.updatedAt
    }).from(notebooks).where(and(eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).orderBy(asc(notebooks.sortOrder), asc(notebooks.createdAt));
    return Response.json({ notebooks: rows });
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("请输入有效的笔记本名称");
    const [folder] = await db.select().from(folders).where(and(eq(folders.userId, userId), parsed.data.folderId ? eq(folders.id, parsed.data.folderId) : eq(folders.isDefault, true))).limit(1);
    if (!folder) return jsonError("目标文件夹不存在", 404);
    const now = nowIso();
    const notebook = { id: crypto.randomUUID(), userId, folderId: folder.id, title: parsed.data.title, coverAssetId: null, sortOrder: Date.now(), createdAt: now, updatedAt: now };
    const [created] = await db.insert(notebooks).values(notebook).returning();
    return Response.json({ notebook: created }, { status: 201 });
  } catch (error) { return jsonError("无法创建笔记本", authError(error)); }
}
