"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LibraryBig, Plus } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { createKnowledgeMentionPlugin, knowledgeMentionKey as key, type KnowledgeMention } from "@/lib/knowledge-mention-plugin";
import { normalizeKnowledgeName } from "@/lib/knowledge-document";
import { getKnowledgeCatalog, subscribeKnowledge, knowledgeRequest, setKnowledgeCatalog, type KnowledgeSummary } from "@/lib/knowledge-client";
import { notify } from "@/lib/notifications";

export function KnowledgeMentions({ editor, currentEntryId }: { editor: Editor; currentEntryId?: string }) {
  const catalog = useSyncExternalStore(subscribeKnowledge, getKnowledgeCatalog, getKnowledgeCatalog);
  const busyRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<KnowledgeMention | null>(null), [index, setIndex] = useState(0), [busy, setBusy] = useState(false);
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const currentEntry = useRef(currentEntryId);
  useEffect(() => { currentEntry.current = currentEntryId; }, [currentEntryId]);
  useEffect(() => {
    const plugin = createKnowledgeMentionPlugin((next) => { setMention(next); setIndex(0); }, (event) => keyHandler.current(event));
    editor.registerPlugin(plugin, (_newPlugin, plugins) => [plugin, ...plugins]);
    return () => { if (!editor.isDestroyed) editor.unregisterPlugin(key); };
  }, [editor]);
  const query = normalizeKnowledgeName(mention?.query ?? "");
  const candidates = useMemo(() => catalog.filter((entry) => entry.id !== currentEntryId && (!query || [entry.title, ...entry.aliases].some((name) => normalizeKnowledgeName(name).includes(query)))).slice(0, 8), [catalog, currentEntryId, query]);
  const exact = useMemo(() => Boolean(query) && catalog.some((entry) => [entry.title, ...entry.aliases].some((name) => normalizeKnowledgeName(name) === query)), [catalog, query]);
  const canCreate = Boolean(query) && !exact;
  async function choose(entry?: KnowledgeSummary) {
    const active = key.getState(editor.state); if (!active || busyRef.current || editor.view.composing) return;
    busyRef.current = true; setBusy(true);
    try {
      let target = entry;
      if (!target) {
        if (!canCreate) return;
        const result = await knowledgeRequest<{ entry: KnowledgeSummary }>("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: active.query.trim() }) });
        target = result.entry; setKnowledgeCatalog([...getKnowledgeCatalog(), target]);
      }
      const latest = key.getState(editor.state);
      if (!latest || latest.query !== active.query || target.id === currentEntry.current || editor.isDestroyed) return;
      editor.chain().focus().insertContentAt({ from: latest.from, to: latest.to }, [{ type: "knowledgeReference", attrs: { entryId: target.id, label: target.title, referenceType: "entry" } }, { type: "text", text: " " }]).run();
      editor.view.dispatch(editor.state.tr.setMeta(key, "close"));
    } catch (error) { notify.error(error instanceof Error ? error.message : "无法创建词条"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  useEffect(() => {
    keyHandler.current = (event) => {
      const count = candidates.length + Number(canCreate);
      if (event.key === "Escape") { event.stopPropagation(); editor.view.dispatch(editor.state.tr.setMeta(key, "close")); return true; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { if (count) setIndex((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + count) % count); return true; }
      if (event.key === "Enter" && count) { void choose(candidates[index]); return true; }
      return false;
    };
  });
  useEffect(() => {
    const list = menuRef.current?.querySelector<HTMLElement>(".knowledge-suggestion-items");
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    const bounds = list.getBoundingClientRect(), option = selected.getBoundingClientRect();
    if (option.top < bounds.top) list.scrollTop += option.top - bounds.top;
    else if (option.bottom > bounds.bottom) list.scrollTop += option.bottom - bounds.bottom;
  }, [index, mention?.query]);
  if (!mention) return null;
  const rect = editor.view.coordsAtPos(Math.min(mention.to, editor.state.doc.content.size));
  const below = window.innerHeight - rect.bottom - 14;
  const opensBelow = below >= 180;
  const available = opensBelow ? below : rect.top - 14;
  return <div ref={menuRef} className="knowledge-suggestions" role="listbox" aria-label="知识库词条联想" style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - 348)), maxHeight: Math.min(360, window.innerHeight - 16, Math.max(120, available)), ...(opensBelow ? { top: rect.bottom + 6 } : { bottom: Math.max(8, window.innerHeight - rect.top + 6) }) }}>
    <div className="knowledge-suggestion-heading" aria-hidden="true"><LibraryBig size={14} />插入词条</div>
    <div className="knowledge-suggestion-items">
      {candidates.map((entry, itemIndex) => <button type="button" role="option" aria-selected={index === itemIndex} key={entry.id} disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void choose(entry)}>
        <span className="knowledge-suggestion-icon"><LibraryBig size={16} /></span><span className="knowledge-suggestion-text"><strong>{entry.title}</strong>{(entry.aliases.length > 0 || entry.summary) && <span title={entry.aliases.join("、")}>{entry.aliases.join(" · ") || entry.summary}</span>}</span>
      </button>)}
      {canCreate && <button className="knowledge-suggestion-create" type="button" role="option" aria-selected={index === candidates.length} disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void choose()}><span className="knowledge-suggestion-icon"><Plus size={16} /></span><span className="knowledge-suggestion-text"><strong>创建词条「{mention.query.trim()}」</strong></span></button>}
      {!candidates.length && !canCreate && <p className="knowledge-suggestion-empty">输入名称或别名查找词条</p>}
    </div>
    <div className="knowledge-suggestion-footer" aria-hidden="true">↑↓ 选择<span>Enter 插入</span><span>Esc 关闭</span></div>
  </div>;
}
