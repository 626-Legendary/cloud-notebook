import { z } from "zod";

export const emptyKnowledgeDocument = { type: "doc", content: [{ type: "paragraph" }] };
export const knowledgeReferenceAttributes = z.object({ entryId: z.string().uuid(), label: z.string().min(1).max(200), referenceType: z.literal("entry") }).strict();
export function normalizeKnowledgeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
export type ReferenceOccurrence = { path: number[]; entryId: string; label: string; valid: boolean };
/** Paths identify an exact node, not all occurrences with the same label. No target recursion. */
export function documentReferences(document: unknown): ReferenceOccurrence[] {
  const references: ReferenceOccurrence[] = [];
  let visited = 0;
  function visit(value: unknown, path: number[]) {
    if (++visited > 100_000 || path.length > 80) throw new Error("正文层级或节点数超过限制");
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown };
    if (node.type === "knowledgeReference") {
      const attrs = node.attrs ?? {};
      references.push({ path, entryId: typeof attrs.entryId === "string" ? attrs.entryId : "", label: typeof attrs.label === "string" ? attrs.label : "失效引用", valid: knowledgeReferenceAttributes.safeParse(attrs).success });
    }
    if (Array.isArray(node.content)) node.content.forEach((child, index) => visit(child, [...path, index]));
  }
  visit(document, []);
  return references;
}
export function replaceReferenceAtPath(document: unknown, path: number[], expected: { entryId: string; label: string }, target: { entryId: string; label: string } | null) {
  const clone: unknown = structuredClone(document);
  let current = clone as { content?: unknown[]; type?: string; attrs?: Record<string, unknown> };
  for (const index of path) {
    if (!Array.isArray(current.content) || !Number.isInteger(index) || index < 0 || !current.content[index]) throw new Error("引用位置已改变，请重新检查");
    current = current.content[index] as typeof current;
  }
  const originalId = typeof current.attrs?.entryId === "string" ? current.attrs.entryId : "";
  const originalLabel = typeof current.attrs?.label === "string" ? current.attrs.label : "失效引用";
  if (current.type !== "knowledgeReference" || originalId !== expected.entryId || originalLabel !== expected.label) throw new Error("引用位置已改变，请重新检查");
  const replacement = target ? { type: "knowledgeReference", attrs: { ...target, referenceType: "entry" } } : { type: "text", text: `@${expected.label}` };
  for (const key of Object.keys(current)) delete (current as Record<string, unknown>)[key];
  Object.assign(current, replacement);
  return clone;
}
export function mapKnowledgeReferences(document: unknown, resolve: (id: string) => string) {
  const clone = structuredClone(document);
  const stack: unknown[] = [clone];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === "knowledgeReference" && typeof node.attrs?.entryId === "string") node.attrs.entryId = resolve(node.attrs.entryId);
    if (node.content) stack.push(...node.content);
  }
  return clone;
}

/** Resolve display names at render/search time; never recurse into target documents. */
export function resolveKnowledgeLabels(document: unknown, titles: ReadonlyMap<string, string>) {
  const clone = structuredClone(document), stack: unknown[] = [clone];
  while (stack.length) {
    const item = stack.pop(); if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const node = item as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === "knowledgeReference" && node.attrs) { const title = titles.get(String(node.attrs.entryId)); if (title) node.attrs.label = title; node.attrs.unresolved = !title; }
    if (node.content) stack.push(...node.content);
  }
  return clone;
}
