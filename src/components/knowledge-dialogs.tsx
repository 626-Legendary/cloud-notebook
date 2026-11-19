"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Pencil, Trash2, X, LoaderCircle, Save, BookOpenText, ArrowUpRight } from "lucide-react";
import dynamic from "next/dynamic";
const PageEditor = dynamic(() => import("@/components/page-editor").then((module) => module.PageEditor), { ssr: false });
import { useConfirm } from "@/components/ui/alert-dialog";
import { resolveKnowledgeLabels } from "@/lib/knowledge-document";
import { ReadableCodeBlock } from "@/components/code-block";
import { renderDocument } from "@/lib/render-document";
import { flushPageEdits, serializePageSave } from "@/lib/page-save-queue";
import { getKnowledgeCatalog, knowledgeRequest, setKnowledgeCatalog, subscribeKnowledge, type KnowledgeSummary } from "@/lib/knowledge-client";
import { refreshKnowledge } from "@/components/knowledge-library";
import { ReferenceCheck } from "@/components/knowledge-reference-check";
import { notify } from "@/lib/notifications";

type Entry = { summary: string; id: string; title: string; content: string; aliases: string[]; version: number; createdAt: string; updatedAt: string };
type Backlink = { id: string; title: string; type: "page" | "entry"; notebookId: string; notebookTitle: string };
type Preview = { id: string; from?: number; to?: number; sourceType?: string; sourceId?: string; x?: number; y?: number };
type Props = { autoSaveMode: string; activePageId?: string; onNavigatePage: (id: string, entryId?: string) => Promise<void>; onRepaired: (id: string, type: "page" | "entry") => Promise<void> };
export function KnowledgeDialogs({ autoSaveMode, activePageId, onNavigatePage, onRepaired }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null), [editing, setEditing] = useState(false), [aliases, setAliases] = useState("");
  const [links, setLinks] = useState<Backlink[]>([]), [preview, setPreview] = useState<Preview | null>(null), [previewEntry, setPreviewEntry] = useState<Entry | null>(null), [previewLoading, setPreviewLoading] = useState(false), [checking, setChecking] = useState(false), [busy, setBusy] = useState(false);
  const catalog = useSyncExternalStore(subscribeKnowledge, getKnowledgeCatalog, getKnowledgeCatalog);
  const current = useRef(entry), editingRef = useRef(editing), aliasesRef = useRef(aliases), activePage = useRef(activePageId), sequence = useRef(0), origin = useRef<HTMLElement | null>(null);
  const confirm = useConfirm();
  useEffect(() => { current.current = entry; editingRef.current = editing; aliasesRef.current = aliases; activePage.current = activePageId; }, [entry, editing, aliases, activePageId]);
  useEffect(() => {
    const controller = new AbortController(); let loadSequence = 0;
    const load = () => {
      const request = ++loadSequence;
      void knowledgeRequest<{ entries: KnowledgeSummary[] }>("/api/knowledge?catalog=1", { signal: controller.signal }).then((data) => { if (!controller.signal.aborted && request === loadSequence) setKnowledgeCatalog(data.entries); }).catch((error: unknown) => { if (!controller.signal.aborted) notify.error(error instanceof Error ? error.message : "无法加载知识库"); });
    };
    setKnowledgeCatalog([], false); load();
    window.addEventListener("cloud-notebook:knowledge-change", load);
    return () => { controller.abort(); window.removeEventListener("cloud-notebook:knowledge-change", load); setKnowledgeCatalog([], false); };
  }, []);
  const flushing = useRef<Promise<void> | null>(null);
  function flushCurrent(): Promise<void> {
    if (flushing.current) return flushing.current;
    const task = flushPending(); flushing.current = task;
    void task.finally(() => { if (flushing.current === task) flushing.current = null; }).catch(() => {});
    return task;
  }
  async function flushPending() {
    const value = current.current;
    if (!value || !editingRef.current) return;
    await flushPageEdits(`entry:${value.id}`);
    const latest = current.current;
    if (!latest || latest.id !== value.id) return;
    const nextAliases = [...new Set(aliasesRef.current.split(/[,，、\n]/).map((name) => name.trim()).filter(Boolean))];
    if (JSON.stringify(nextAliases) === JSON.stringify(latest.aliases)) return;
    await serializePageSave(`entry:${value.id}`, async () => {
      const response = await knowledgeRequest<{ page: Entry }>(`/api/knowledge/${value.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: current.current?.version ?? value.version, aliases: nextAliases }) });
      current.current = response.page; setEntry(response.page); setAliases(response.page.aliases.join("、")); aliasesRef.current = response.page.aliases.join("、"); refreshKnowledge();
    });
  }
  async function show(id: string, edit = false) {
    const request = ++sequence.current;
    setBusy(true);
    try {
      await flushCurrent();
      const data = await knowledgeRequest<{ entry: Entry; backlinks: Backlink[] }>(`/api/knowledge/${id}`);
      if (request !== sequence.current) return;
      if (!current.current && document.activeElement instanceof HTMLElement) origin.current = document.activeElement;
      setEntry(data.entry); current.current = data.entry; setAliases(data.entry.aliases.join("、")); setLinks(data.backlinks); setEditing(edit); editingRef.current = edit; setPreview(null);
      return true;
    } catch (error) { notify.error(error instanceof Error ? error.message : "无法读取词条"); return false; }
    finally { if (request === sequence.current) setBusy(false); }
  }
  async function close() {
    setBusy(true);
    try { await flushCurrent(); sequence.current++; setEntry(null); current.current = null; setEditing(false); editingRef.current = false; refreshKnowledge(); return true; }
    catch (error) {
      notify.error(error instanceof Error ? error.message : "请先保存词条");
      const id = current.current?.id;
      let hasDraft = false;
      try { hasDraft = Boolean(id && localStorage.getItem(`cloud-notebook-draft:entry:${id}`)); } catch { /* Closing still requires explicit confirmation. */ }
      if (await confirm(hasDraft ? "保存失败。正文的本地草稿会保留，但未保存的别名会放弃。仍要关闭词条？" : "尚有未保存的内容，无法确认本地草稿。关闭将放弃未保存的修改，仍要继续？", "仍然关闭")) { sequence.current++; setEntry(null); current.current = null; setEditing(false); editingRef.current = false; return true; }
      return false;
    }
    finally { setBusy(false); }
  }
  async function saveEntry() {
    setBusy(true);
    try { await flushCurrent(); refreshKnowledge(); notify.success("词条已保存"); }
    catch (error) { notify.error(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  async function deleteEntry() {
    const value = current.current; if (!value || busy) return;
    setBusy(true);
    try {
      const data = await knowledgeRequest<{ backlinks: Backlink[] }>(`/api/knowledge/${value.id}`);
      if (!await confirm(`删除此词条？${data.backlinks.length ? `共有 ${data.backlinks.length} 处来源引用它，相关引用将失效并保留原文字。` : "未被引用的词条也是有效知识，请确认删除。"}`, "删除词条")) return;
      await flushCurrent();
      await serializePageSave(`entry:${value.id}`, () => knowledgeRequest(`/api/knowledge/${value.id}`, { method: "DELETE" }));
      sequence.current++; setEntry(null); current.current = null; setEditing(false); editingRef.current = false; refreshKnowledge();
    } catch(error) { notify.error(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }
  const actions = useRef({ show, close, flushCurrent });
  useEffect(() => { actions.current = { show, close, flushCurrent }; });
  useEffect(() => {
    const open = (event: Event) => { const { id, editing } = (event as CustomEvent<{ id: string; editing?: boolean }>).detail; void actions.current.show(id, editing); };
    const showPreview = (event: Event) => {
      const detail = (event as CustomEvent<Preview>).detail;
      if (current.current && getKnowledgeCatalog().some((item) => item.id === detail.id)) { void actions.current.show(detail.id); return; }
      setPreviewLoading(true); setPreview(detail); setPreviewEntry(null);
    };
    const check = () => { void (async () => { try { await actions.current.flushCurrent(); if (activePage.current) await flushPageEdits(activePage.current); setEntry(null); current.current = null; setEditing(false); editingRef.current = false; setPreview(null); setChecking(true); } catch (error) { notify.error(error instanceof Error ? error.message : "请先保存当前内容"); } })(); };
    window.addEventListener("cloud-notebook:knowledge-open", open); window.addEventListener("cloud-notebook:knowledge-preview", showPreview); window.addEventListener("cloud-notebook:reference-check", check);
    return () => { window.removeEventListener("cloud-notebook:knowledge-open", open); window.removeEventListener("cloud-notebook:knowledge-preview", showPreview); window.removeEventListener("cloud-notebook:reference-check", check); };
  }, []);
  useEffect(() => {
    if (!preview) return;
    const controller = new AbortController();
    void knowledgeRequest<{ entry: Entry }>(`/api/knowledge/${preview.id}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setPreviewEntry(data.entry); }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [preview]);
  function body(raw: string) {
    try { return renderDocument(JSON.stringify(resolveKnowledgeLabels(JSON.parse(raw), new Map(catalog.map((item) => [item.id, item.title])))), (text, language) => <ReadableCodeBlock text={text} language={language} />); }
    catch { return <p>正文格式无法读取，请执行引用检查。</p>; }
  }
  return <>
    <Popover.Root open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}><Popover.Anchor asChild><span className="knowledge-preview-anchor" style={{ left: preview?.x ?? 40, top: preview?.y ?? 100 }} /></Popover.Anchor><Popover.Portal><Popover.Content className="popover-content knowledge-preview" sideOffset={8} onOpenAutoFocus={(event) => event.preventDefault()}>
      <div className="knowledge-preview-heading"><BookOpenText size={16} /><strong title={previewEntry?.title}>{previewEntry?.title ?? catalog.find((item) => item.id === preview?.id)?.title ?? (previewLoading ? "正在加载词条…" : "词条已删除或不存在")}</strong></div>
      <p className="knowledge-preview-summary">{previewEntry ? previewEntry.summary || "暂无内容" : previewLoading ? "正在读取词条内容…" : "无法读取目标词条，可以检查并修复此引用。"}</p>
      <div className="knowledge-preview-actions">{previewLoading ? <span role="status">加载中…</span> : previewEntry ? <button className="button-subtle" onClick={() => void show(previewEntry.id)}>查看完整词条<ArrowUpRight size={15} /></button> : <button className="button-subtle" onClick={() => window.dispatchEvent(new Event("cloud-notebook:reference-check"))}>引用检查与修复<ArrowUpRight size={15} /></button>}</div>
    </Popover.Content></Popover.Portal></Popover.Root>
    <Dialog.Root open={entry !== null} onOpenChange={(open) => { if (!open && !busy) void close(); }}><Dialog.Portal><Dialog.Overlay className="knowledge-dialog-overlay" /><Dialog.Content className="knowledge-dialog" onEscapeKeyDown={(event) => { if (event.defaultPrevented) return; event.preventDefault(); if (document.querySelector(".knowledge-suggestions")) return; if (!busy) void close(); }} onInteractOutside={(event) => event.preventDefault()} onCloseAutoFocus={(event) => { event.preventDefault(); if (origin.current?.isConnected) origin.current.focus(); }}>
      <Dialog.Description className="sr-only">阅读或编辑知识库词条，使用内部引用切换相关知识。</Dialog.Description>
      <header className="knowledge-dialog-header"><div className="knowledge-controls"><BookOpenText size={18} /><Dialog.Title className="text-ui-heading" title={entry?.title}>{entry?.title}</Dialog.Title></div><div className="knowledge-controls">{busy && <LoaderCircle className="spin" size={16} />}{!editing ? <button className="button-outline" disabled={busy} onClick={() => { setEditing(true); editingRef.current = true; }}><Pencil size={15} />编辑词条</button> : <button className="button-primary" disabled={busy} onClick={() => void saveEntry()}><Save size={15} />保存</button>}<button className="icon-button destructive" aria-label="删除词条" disabled={busy} onClick={() => void deleteEntry()}><Trash2 size={16} /></button><button className="icon-button" aria-label="关闭词条" disabled={busy} onClick={() => void close()}><X size={17} /></button></div></header>
      {entry && (editing ? <><label className="knowledge-aliases">别名（逗号分隔）<input className="control-input" aria-label="词条别名" disabled={busy} value={aliases} maxLength={6000} onChange={(event) => setAliases(event.target.value)} /></label><div className="knowledge-shared-editor" inert={busy}><PageEditor key={entry.id} resourceType="entry" page={entry} autoSaveMode={autoSaveMode} breadcrumb={{ folder: "知识库", notebook: "词条", page: entry.title }} onNavigateFolder={() => {}} onNavigateNotebook={() => {}} onOpenSidebar={() => {}} onOpenPages={() => {}} onSaved={(page) => { if (current.current?.id === page.id) { const updated = { ...current.current, ...page }; current.current = updated; setEntry(updated); } refreshKnowledge(); }} onOpenHistory={() => {}} onExport={() => {}} onGlobalSearch={() => {}} /></div></> : <div className="knowledge-reader-scroll"><div className="knowledge-aliases">{entry.aliases.length > 0 && <p>别名：{entry.aliases.join("、")}</p>}</div><article className="notebook-editor" onClick={(event) => { const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-knowledge-reference]") : null; if (target?.dataset.entryId) { if (catalog.some((item) => item.id === target.dataset.entryId)) void show(target.dataset.entryId); else window.dispatchEvent(new CustomEvent("cloud-notebook:knowledge-preview", { detail: { id: target.dataset.entryId, sourceType: "entry", sourceId: entry.id, x: event.clientX, y: event.clientY } })); } }}>{body(entry.content)}</article><section className="knowledge-backlinks"><h2 className="text-ui-heading">引用此词条的内容</h2>{links.map((link) => <button className="knowledge-backlink" key={`${link.type}:${link.id}`} onClick={() => { if (link.type === "entry") void show(link.id); else void close().then((closed) => { if (closed) void onNavigatePage(link.id, entry.id); }); }}>{link.title}<span>{link.type === "page" ? link.notebookTitle : "知识库词条"}</span></button>)}{!links.length && <p className="status-line">暂无引用来源</p>}</section></div>)}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    {checking && <ReferenceCheck onClose={() => setChecking(false)} beforeScan={async () => { if (activePageId) await flushPageEdits(activePageId); }} onNavigate={async (id, type, target) => { setChecking(false); if (type === "entry") await show(id); else await onNavigatePage(id, target); }} onRepaired={onRepaired} />}
  </>;
}
