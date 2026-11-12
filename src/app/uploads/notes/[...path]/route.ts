import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { jsonError } from "@/lib/http";

const assetName = /^[0-9a-f-]{36}$/i;

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session || session.mustChangePassword) return jsonError("请先登录", session ? 403 : 401);
  const { path: parts } = await context.params;
  if (parts.length !== 1 || !assetName.test(parts[0])) return jsonError("图片不存在", 404);
  const ownerScope = session.role === "ADMIN" ? eq(assets.id, parts[0]) : and(eq(assets.id, parts[0]), eq(assets.userId, session.userId));
  const [asset] = await db.select().from(assets).where(ownerScope).limit(1);
  if (!asset) return jsonError("图片不存在", 404);
  const root = path.resolve(process.cwd(), "data/uploads/notes");
  const file = path.resolve(root, asset.storagePath);
  if (path.dirname(file) !== root || path.basename(asset.storagePath) !== asset.storagePath || !asset.storagePath.toLowerCase().startsWith(`${asset.id.toLowerCase()}.`)) return jsonError("图片不存在", 404);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return jsonError("图片不存在", 404);
    const bytes = await fs.readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.size),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return jsonError("图片文件不存在", 404);
    console.error("Asset read failed", error);
    return jsonError("读取图片失败", 500);
  }
}
