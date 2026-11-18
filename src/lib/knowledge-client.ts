"use client";
import type { NodeViewConstructor } from "@tiptap/pm/view";

export type KnowledgeSummary = { id: string; title: string; aliases: string[]; summary: string; tags: { id: string; name: string }[]; createdAt: string; updatedAt: string };
let entries: KnowledgeSummary[] = [], loaded = false;
let entryIndex = new Map<string, KnowledgeSummary>();
const listeners = new Set<() => void>();
export const getKnowledgeCatalog = () => entries;
export function setKnowledgeCatalog(next: KnowledgeSummary[], ready = true) { entries = next; entryIndex = new Map(next.map((entry) => [entry.id, entry])); loaded = ready; for (const listener of listeners) listener(); }
export function subscribeKnowledge(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function previewKnowledge(id: string, from?: number, to?: number, sourceType?: string, sourceId?: string) {
  window.dispatchEvent(new CustomEvent("cloud-notebook:knowledge-preview", { detail: { id, from, to, sourceType, sourceId } }));
}
export const knowledgeNodeView: NodeViewConstructor = (initialNode) => {
  const dom = document.createElement("span"); let node = initialNode;
  const render = () => {
    const entry = entryIndex.get(node.attrs.entryId);
    const className = `knowledge-reference${loaded && !entry ? " knowledge-reference-invalid" : ""}`;
    const text = `@${entry?.title ?? node.attrs.label}`;
    if (dom.className !== className) dom.className = className;
    if (dom.dataset.knowledgeReference !== "entry") dom.dataset.knowledgeReference = "entry";
    if (dom.dataset.entryId !== node.attrs.entryId) dom.dataset.entryId = node.attrs.entryId;
    if (dom.textContent !== text) dom.textContent = text;
    if (dom.contentEditable !== "false") dom.contentEditable = "false";
    const title = loaded && !entry ? "词条已删除或不存在，点击检查引用" : "点击预览词条";
    if (dom.title !== title) dom.title = title;
  };
  const unsubscribe = subscribeKnowledge(render); render();
  return { dom, update(next) { if (next.type !== node.type) return false; node = next; render(); return true; }, destroy: unsubscribe };
};
export async function knowledgeRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "操作失败");
  return data as T;
}
