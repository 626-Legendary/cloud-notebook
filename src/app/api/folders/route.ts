import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso } from "@/db";
import { folders } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const folderSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET() {
  try {
    const { userId } = await requireUser();
    return Response.json({ folders: await db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.sortOrder), asc(folders.createdAt)) });
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const parsed = folderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("请输入有效的文件夹名称");
    const now = nowIso();
    const folder = { id: crypto.randomUUID(), userId, name: parsed.data.name, sortOrder: Date.now(), isDefault: false, createdAt: now, updatedAt: now };
    await db.insert(folders).values(folder);
    return Response.json({ folder }, { status: 201 });
  } catch (error) { return jsonError("无法创建文件夹", authError(error)); }
}
