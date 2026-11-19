import { sqlite } from "@/db";
import { normalizeKnowledgeName } from "@/lib/knowledge-document";

export function listAdminKnowledge(query: string, status: "active" | "trash", page: number) {
  const escape = (value: string) => value.replace(/[\\%_]/g, "\\$&");
  const where = `u.role='USER' AND e.deleted_at IS ${status === "active" ? "NULL" : "NOT NULL"}
    AND (@empty OR u.username LIKE @query ESCAPE '\\' OR e.title LIKE @query ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM knowledge_names n WHERE n.entry_id=e.id AND n.user_id=e.user_id AND n.normalized_name LIKE @normalized ESCAPE '\\'))`;
  const params = { empty: Number(!query.trim()), query: `%${escape(query.trim())}%`, normalized: `%${escape(normalizeKnowledgeName(query))}%` };
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries e JOIN users u ON u.id=e.user_id WHERE ${where}`).get(params) as { n: number }).n;
  const pageSize = 20, pages = Math.max(1, Math.ceil(total / pageSize)), currentPage = Math.min(page, pages);
  const rows = sqlite.prepare(`SELECT e.id,e.title,e.user_id AS userId,u.username,e.version,e.created_at AS createdAt,e.updated_at AS updatedAt,e.deleted_at AS deletedAt
    FROM knowledge_entries e JOIN users u ON u.id=e.user_id WHERE ${where} ORDER BY e.updated_at DESC,e.id LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (currentPage - 1) * pageSize }) as { id: string; title: string; userId: string; username: string; version: number; createdAt: string; updatedAt: string; deletedAt: string | null }[];
  const aliases = sqlite.prepare("SELECT name FROM knowledge_names WHERE entry_id=? AND user_id=? AND kind='alias' ORDER BY normalized_name");
  return { entries: rows.map((row) => ({ ...row, aliases: (aliases.all(row.id,row.userId) as { name: string }[]).map((item) => item.name) })), total, page: currentPage, pages, pageSize };
}
