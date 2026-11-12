import { sqlite } from "@/db";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

export async function DELETE(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { type, id } = await context.params;
    if (type === "notebook") {
      const result = sqlite.prepare("DELETE FROM notebooks WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL").run(id, userId);
      return result.changes ? Response.json({ ok: true }) : jsonError("垃圾箱中的笔记本不存在", 404);
    }
    if (type === "page") {
      const result = sqlite.prepare(`
        DELETE FROM pages WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM notebooks WHERE notebooks.id = pages.notebook_id AND notebooks.deleted_at IS NULL)
      `).run(id, userId);
      return result.changes ? Response.json({ ok: true }) : jsonError("垃圾箱中的页面不存在", 404);
    }
    return jsonError("删除类型无效", 400);
  } catch (error) { return jsonError("无法永久删除项目", authError(error)); }
}
