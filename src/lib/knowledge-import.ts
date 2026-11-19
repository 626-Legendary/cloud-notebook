import { sqlite } from "@/db";
import { KnowledgeError } from "@/lib/knowledge";
import { normalizeKnowledgeName } from "@/lib/knowledge-document";

export type ImportPolicy = "reject" | "reuse" | "rename";
export type ImportConflict = { incomingTitle: string; existingTitles: string[]; canReuse: boolean };
type IncomingEntry = { id: string; title: string; aliases: string[] };

/** Plan inside the write transaction too: an earlier preview cannot authorize stale names. */
export function planKnowledgeImport(userId: string, entries: IncomingEntry[], policy: ImportPolicy) {
  const rows = sqlite.prepare(`SELECT n.normalized_name AS name,n.entry_id AS id,e.title
    FROM knowledge_names n JOIN knowledge_entries e ON e.id=n.entry_id
    WHERE n.user_id=? AND e.user_id=? AND e.deleted_at IS NULL`).all(userId, userId) as { name: string; id: string; title: string }[];
  const namespace = new Map(rows.map((row) => [row.name, row]));
  const occupied = new Set(namespace.keys());
  // Reserve incoming names before generating suffixes, so renaming cannot steal another incoming name.
  for (const entry of entries) for (const name of [entry.title, ...entry.aliases]) occupied.add(normalizeKnowledgeName(name));
  const conflicts: ImportConflict[] = [];
  const plans = entries.map((entry) => {
    const matches = new Map<string, string>();
    for (const name of [entry.title, ...entry.aliases]) {
      const match = namespace.get(normalizeKnowledgeName(name));
      if (match) matches.set(match.id, match.title);
    }
    if (matches.size) conflicts.push({ incomingTitle: entry.title, existingTitles: [...matches.values()], canReuse: matches.size === 1 });
    let renamed = false;
    const rename = (name: string) => {
      if (policy !== "rename" || !namespace.has(normalizeKnowledgeName(name))) return name;
      for (let number = 1; ; number++) {
        const suffix = `（导入 ${number}）`;
        const candidate = name.slice(0, 120 - suffix.length) + suffix;
        const normalized = normalizeKnowledgeName(candidate);
        if (!occupied.has(normalized)) { occupied.add(normalized); renamed = true; return candidate; }
      }
    };
    const reused = policy === "reuse" && matches.size === 1;
    return { sourceId: entry.id, id: reused ? [...matches.keys()][0] : crypto.randomUUID(), title: rename(entry.title), aliases: entry.aliases.map(rename), reused, renamed };
  });
  if (conflicts.length && (policy === "reject" || policy === "reuse" && conflicts.some((item) => !item.canReuse))) {
    throw new KnowledgeError("导入词条的正式名称或别名与已有词条冲突，请选择处理方式", 409, { conflicts, canReuse: conflicts.every((item) => item.canReuse) });
  }
  return plans;
}
