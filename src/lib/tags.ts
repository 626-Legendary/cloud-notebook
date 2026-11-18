import { sqlite } from "@/db";
import { z } from "zod";
import { KnowledgeError, ownSource, sourceTags } from "@/lib/knowledge";
import { normalizeKnowledgeName } from "@/lib/knowledge-document";

export const tagNameSchema = z.string().trim().min(1).max(60).refine((name) => Boolean(normalizeKnowledgeName(name)));
export const tagActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: tagNameSchema }).strict(),
  z.object({ action: z.literal("rename"), id: z.string().uuid(), name: tagNameSchema }).strict(),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("merge"), id: z.string().uuid(), targetId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("assign"), sourceType: z.enum(["page", "entry"]), sourceId: z.string().uuid(), tagIds: z.array(z.string().uuid()).max(100) }).strict()
]);
export function listTags(userId: string) {
  return sqlite.prepare("SELECT id,name FROM tags WHERE user_id=? ORDER BY name").all(userId) as { id: string; name: string }[];
}
export function applyTagAction(userId: string, input: z.infer<typeof tagActionSchema>) {
  return sqlite.transaction(() => {
    const ownTag = (id: string) => { if (!sqlite.prepare("SELECT id FROM tags WHERE id=? AND user_id=?").get(id, userId)) throw new KnowledgeError("标签不存在", 404); };
    if (input.action === "assign") {
      ownSource(userId, input.sourceType, input.sourceId);
      for (const id of input.tagIds) ownTag(id);
      sqlite.prepare("DELETE FROM content_tags WHERE source_type=? AND source_id=?").run(input.sourceType, input.sourceId);
      for (const id of new Set(input.tagIds)) sqlite.prepare("INSERT INTO content_tags (tag_id,source_type,source_id) VALUES (?,?,?)").run(id, input.sourceType, input.sourceId);
      return { tags: sourceTags(userId, input.sourceType, input.sourceId) };
    }
    if (input.action !== "create") ownTag(input.id);
    if (input.action === "create" || input.action === "rename") {
      const normalized = normalizeKnowledgeName(input.name);
      const existing = sqlite.prepare("SELECT id FROM tags WHERE user_id=? AND normalized_name=?").get(userId, normalized) as { id: string } | undefined;
      if (existing && (input.action === "create" || existing.id !== input.id)) throw new KnowledgeError("标签名称已存在", 409);
      const now = new Date().toISOString();
      if (input.action === "create") sqlite.prepare("INSERT INTO tags (id,user_id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(), userId, input.name, normalized, now, now);
      else sqlite.prepare("UPDATE tags SET name=?,normalized_name=?,updated_at=? WHERE id=? AND user_id=?").run(input.name, normalized, now, input.id, userId);
    } else {
      if (input.action === "merge") {
        if (input.id === input.targetId) throw new KnowledgeError("请选择不同的目标标签");
        ownTag(input.targetId);
        sqlite.prepare("INSERT OR IGNORE INTO content_tags (tag_id,source_type,source_id) SELECT ?,source_type,source_id FROM content_tags WHERE tag_id=?").run(input.targetId, input.id);
      }
      sqlite.prepare("DELETE FROM tags WHERE id=? AND user_id=?").run(input.id, userId);
    }
    return { tags: listTags(userId) };
  }).immediate();
}
