import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db, nowIso } from "@/db";
import { assets } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { detectImage } from "@/lib/images";
import { assertSameOrigin, jsonError } from "@/lib/http";

const fileLabel = z.string().max(200);

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  let savedPath: string | undefined;
  try {
    const { userId } = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("请选择图片");
    const limit = Math.max(1, Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10)) * 1024 * 1024;
    if (file.size === 0 || file.size > limit) return jsonError(`图片大小不能超过 ${Math.floor(limit / 1024 / 1024)} MB`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const detected = detectImage(bytes);
    if (!detected) return jsonError("仅支持有效的 JPG、PNG、WebP 或 GIF 图片");
    const id = crypto.randomUUID();
    const fileName = `${id}.${detected.extension}`;
    const root = path.resolve(process.cwd(), "data/uploads/notes");
    await fs.mkdir(root, { recursive: true });
    savedPath = path.join(root, fileName);
    await fs.writeFile(savedPath, bytes, { flag: "wx", mode: 0o600 });
    const originalName = fileLabel.safeParse(file.name);
    await db.insert(assets).values({
      id, userId, storagePath: fileName, mimeType: detected.mime,
      originalName: originalName.success ? path.basename(originalName.data) : "image",
      size: bytes.length, createdAt: nowIso()
    });
    return Response.json({ asset: { id, url: `/uploads/notes/${id}`, mimeType: detected.mime } }, { status: 201 });
  } catch (error) {
    if (savedPath) await fs.rm(savedPath, { force: true }).catch(() => undefined);
    return jsonError("图片上传失败", authError(error));
  }
}
