import { sqlite } from "@/db";
import { requireAdmin, authError } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  try {
    await requireAdmin();
    const rows = sqlite.prepare(`
      SELECT users.id, users.username, users.created_at AS createdAt,
        (SELECT COUNT(*) FROM notebooks WHERE notebooks.user_id = users.id AND notebooks.deleted_at IS NULL) AS notebookCount,
        (SELECT COUNT(*) FROM pages INNER JOIN notebooks ON notebooks.id = pages.notebook_id
          WHERE pages.user_id = users.id AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL) AS pageCount,
        (SELECT COUNT(*) FROM assets WHERE assets.user_id = users.id) AS imageCount,
        (SELECT COALESCE(SUM(size), 0) FROM assets WHERE assets.user_id = users.id) AS storageBytes
      FROM users WHERE users.role = 'USER' ORDER BY users.created_at
    `).all() as {
      id: string; username: string; createdAt: string; notebookCount: number;
      pageCount: number; imageCount: number; storageBytes: number
    }[];
    return Response.json({ users: rows });
  } catch (error) { return jsonError("无权访问", authError(error)); }
}
