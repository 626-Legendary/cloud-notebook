"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { ArrowLeft, Pencil, Trash2, X, LoaderCircle } from "lucide-react";
import dynamic from "next/dynamic";
const PageEditor = dynamic(() => import("@/components/page-editor").then((module) => module.PageEditor), { ssr: false });
import { useConfirm } from "@/components/ui/alert-dialog";
import { resolveKnowledgeLabels, normalizeKnowledgeName } from "@/lib/knowledge-document";
import { renderDocument } from "@/lib/render-document";
import { flushPageEdits } from "@/lib/page-save-queue";
import { getKnowledgeCatalog, knowledgeRequest, setKnowledgeCatalog, subscribeKnowledge, type KnowledgeSummary } from "@/lib/knowledge-client";
import { refreshKnowledge } from "@/components/knowledge-library";
import { notify } from "@/lib/notifications";

type Entry = { summary: string; id: string; title: string; content: string; aliases: string[]; tags: { id: string; name: string }[]; version: number; createdAt: string; updatedAt: string };
type Backlink = { id: string; title: string; type: "page" | "entry"; notebookId: string; notebookTitle: string };
type Preview = { id: string; from?: number; to?: number; sourceType?: string; sourceId?: string; x?: number; y?: number };
type Props = { autoSaveMode: string; activePageId?: string; onNavigatePage: (id: string, entryId?: string) => Promise<void>; onRepaired: (id: string, type: "page" | "entry") => Promise<void> };
export function KnowledgeDialogs({ autoSaveMode, activePageId, onNavigatePage, onRepaired }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null), [history, setHistory] = useState<string[]>([]), [editing, setEditing] = useState(false), [aliases, setAliases] = useState("");
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
    window.addEventListener("cloud-notebook:knowledge-change", load); window.addEventListener("cloud-notebook:tags-change", load);
    return () => { controller.abort(); window.removeEventListener("cloud-notebook:knowledge-change", load); window.removeEventListener("cloud-notebook:tags-change", load); setKnowledgeCatalog([], false); };
  }, []);
  async function flushCurrent() {
    const value = current.current;
    if (!value || !editingRef.current) return;
    await flushPageEdits(`entry:${value.id}`);
    const latest = await knowledgeRequest<{ entry: Entry }>(`/api/knowledge/${value.id}`);
    if (aliasesRef.current !== value.aliases.join("、")) {
      const response = await knowledgeRequest<{ page: Entry }>(`/api/knowledge/${value.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: current.current?.version ?? value.version, aliases: aliasesRef.current.split(/[,，、\n]/).map((name) => name.trim()).filter(Boolean) }) });
      setEntry(response.page); current.current = response.page; setAliases(response.page.aliases.join("、")); aliasesRef.current = response.page.aliases.join("、"); refreshKnowledge();
    } else { setEntry(latest.entry); current.current = latest.entry; }
  }
  async function show(id: string, back = false) {
    const request = ++sequence.current;
    setBusy(true);
    try {
      await flushCurrent();
      const data = await knowledgeRequest<{ entry: Entry; backlinks: Backlink[] }>(`/api/knowledge/${id}`);
      if (request !== sequence.current) return;
      if (!current.current && document.activeElement instanceof HTMLElement) origin.current = document.activeElement;
      setEntry(data.entry); current.current = data.entry; setAliases(data.entry.aliases.join("、")); setLinks(data.backlinks); setEditing(false); editingRef.current = false; setPreview(null);
      if (!back) setHistory((items) => [...items, id].slice(-100));
      return true;
    } catch (error) { notify.error(error instanceof Error ? error.message : "无法读取词条"); return false; }
    finally { if (request === sequence.current) setBusy(false); }
  }
  async function close() {
    setBusy(true);
    try { await flushCurrent(); sequence.current++; setEntry(null); current.current = null; setEditing(false); editingRef.current = false; setHistory([]); refreshKnowledge(); return true; }
    catch (error) {
      notify.error(error instanceof Error ? error.message : "请先保存词条");
      const id = current.current?.id;
      let hasDraft = false;
      try { hasDraft = Boolean(id && localStorage.getItem(`cloud-notebook-draft:entry:${id}`)); } catch { /* Closing still requires explicit confirmation. */ }
      if (await confirm(hasDraft ? "保存失败。正文的本地草稿会保留，但未保存的别名会放弃。仍要关闭词条？" : "尚有未保存的内容，无法确认本地草稿。关闭将放弃未保存的修改，仍要继续？", "仍然关闭")) { sequence.current++; setEntry(null); current.current = null; setEditing(false); editingRef.current = false; setHistory([]); return true; }
      return false;
    }
    finally { setBusy(false); }
  }
  async function saveAndRead() {
    setBusy(true);
    try { await flushCurrent(); setEditing(false); editingRef.current = false; refreshKnowledge(); }
    catch (error) { notify.error(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  const actions = useRef({ show, close, flushCurrent });
  useEffect(() => { actions.current = { show, close, flushCurrent }; });
  useEffect(() => {
    const open = (event: Event) => { const { id } = (event as CustomEvent<{ id: string }>).detail; void actions.current.show(id); };
    const showPreview = (event: Event) => {
      const detail = (event as CustomEvent<Preview>).detail;
      if (current.current && getKnowledgeCatalog().some((item) => item.id === detail.id)) { void actions.current.show(detail.id); return; }
      setPreviewLoading(true); setPreview(detail); setPreviewEntry(null);
    };
    const check = () => { void (async () => { try { await actions.current.flushCurrent(); if (activePage.current) await flushPageEdits(activePage.current); setEntry(null); current.current = null; setHistory([]); setEditing(false); editingRef.current = false; setPreview(null); setChecking(true); } catch (error) { notify.error(error instanceof Error ? error.message : "请先保存当前内容"); } })(); };
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
    try { return renderDocument(JSON.stringify(resolveKnowledgeLabels(JSON.parse(raw), new Map(catalog.map((item) => [item.id, item.title]))))); }
    catch { return <p>正文格式无法读取，请执行引用检查。</p>; }
  }
  return <>
    <Popover.Root open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}><Popover.Anchor asChild><span className="knowledge-preview-anchor" style={{ left: preview?.x ?? 40, top: preview?.y ?? 100 }} /></Popover.Anchor><Popover.Portal><Popover.Content className="popover-content knowledge-preview" sideOffset={8} onOpenAutoFocus={(event) => event.preventDefault()}>
      <strong>{previewEntry?.title ?? catalog.find((item) => item.id === preview?.id)?.title ?? (previewLoading ? "正在加载词条…" : "词条已删除或不存在")}</strong><p>{previewEntry ? previewEntry.summary || "暂无正文" : previewLoading ? "正在读取词条内容…" : "无法读取目标词条，可以检查并修复此引用。"}</p><div>{previewEntry?.tags.map((tag) => <span className="knowledge-tag" key={tag.id}>{tag.name}</span>)}</div>
      {previewLoading ? <span role="status">加载中…</span> : previewEntry ? <button className="button-outline" onClick={() => void show(previewEntry.id)}>查看完整词条</button> : <button className="button-outline" onClick={() => window.dispatchEvent(new Event("cloud-notebook:reference-check"))}>引用检查与修复</button>}
    </Popover.Content></Popover.Portal></Popover.Root>
    <Dialog.Root open={entry !== null} onOpenChange={(open) => { if (!open && !busy) void close(); }}><Dialog.Portal><Dialog.Overlay className="knowledge-dialog-overlay" /><Dialog.Content className="knowledge-dialog" onEscapeKeyDown={(event) => { if (event.defaultPrevented) return; event.preventDefault(); if (document.querySelector(".knowledge-suggestions")) return; if (!busy) void close(); }} onInteractOutside={(event) => event.preventDefault()} onCloseAutoFocus={(event) => { event.preventDefault(); if (origin.current?.isConnected) origin.current.focus(); }}>
      <Dialog.Description className="sr-only">阅读或编辑知识库词条，使用内部引用切换相关知识。</Dialog.Description>
      <header className="knowledge-dialog-header"><div className="knowledge-controls"><button type="button" className="icon-button" aria-label="返回上一词条" disabled={busy || history.length < 2} onClick={() => { const previous = history[history.length - 2]; void show(previous, true).then((shown) => { if (shown) setHistory((items) => items.slice(0, -1)); }); }}><ArrowLeft size={17} /></button><Dialog.Title className="text-ui-heading">{entry?.title}</Dialog.Title></div><div className="knowledge-controls">{busy && <LoaderCircle className="spin" size={16} />}{!editing ? <button className="button-outline" disabled={busy} onClick={() => { setEditing(true); editingRef.current = true; }}><Pencil size={15} />编辑词条</button> : <button className="button-primary" disabled={busy} onClick={() => void saveAndRead()}>保存并阅读</button>}<button className="icon-button destructive" aria-label="删除词条" disabled={busy} onClick={() => void (async () => { if (!entry) return; try { await flushCurrent(); const data = await knowledgeRequest<{ backlinks: Backlink[] }>(`/api/knowledge/${entry.id}`); if (!await confirm(`删除此词条？${data.backlinks.length ? `共有 ${data.backlinks.length} 处来源引用它，相关引用将失效并保留原文字。` : "未被引用的词条也是有效知识，请确认删除。"}`, "删除词条")) return; await knowledgeRequest(`/api/knowledge/${entry.id}`, { method: "DELETE" }); setEntry(null); current.current = null; setHistory([]); refreshKnowledge(); } catch (error) { notify.error(error instanceof Error ? error.message : "删除失败"); } })()}><Trash2 size={16} /></button><button className="icon-button" aria-label="关闭词条" disabled={busy} onClick={() => void close()}><X size={17} /></button></div></header>
      {entry && (editing ? <><label className="knowledge-aliases">别名（逗号分隔）<input className="control-input" aria-label="词条别名" disabled={busy} value={aliases} maxLength={6000} onChange={(event) => setAliases(event.target.value)} /></label><div className="knowledge-shared-editor" inert={busy}><PageEditor key={entry.id} resourceType="entry" page={entry} autoSaveMode={autoSaveMode} breadcrumb={{ folder: "知识库", notebook: "词条", page: entry.title }} onNavigateFolder={() => {}} onNavigateNotebook={() => {}} onOpenSidebar={() => {}} onOpenPages={() => {}} onSaved={(page) => { if (current.current?.id === page.id) { const updated = { ...current.current, ...page }; current.current = updated; setEntry(updated); } refreshKnowledge(); }} onOpenHistory={() => {}} onExport={() => {}} onGlobalSearch={() => {}} /></div></> : <div className="knowledge-reader-scroll"><div className="knowledge-aliases">{entry.aliases.length > 0 && <p>别名：{entry.aliases.join("、")}</p>}{entry.tags.map((tag) => <span className="knowledge-tag" key={tag.id}>{tag.name}</span>)}</div><article className="notebook-editor" onClick={(event) => { const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-knowledge-reference]") : null; if (target?.dataset.entryId) { if (catalog.some((item) => item.id === target.dataset.entryId)) void show(target.dataset.entryId); else window.dispatchEvent(new CustomEvent("cloud-notebook:knowledge-preview", { detail: { id: target.dataset.entryId, sourceType: "entry", sourceId: entry.id, x: event.clientX, y: event.clientY } })); } }}>{body(entry.content)}</article><section className="knowledge-backlinks"><h2 className="text-ui-heading">引用此词条的内容</h2>{links.map((link) => <button className="knowledge-backlink" key={`${link.type}:${link.id}`} onClick={() => { if (link.type === "entry") void show(link.id); else void close().then((closed) => { if (closed) void onNavigatePage(link.id, entry.id); }); }}>{link.title}<span>{link.type === "page" ? link.notebookTitle : "知识库词条"}</span></button>)}{!links.length && <p className="status-line">暂无引用来源</p>}</section></div>)}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    {checking && <ReferenceCheck onClose={() => setChecking(false)} beforeScan={async () => { if (activePageId) await flushPageEdits(activePageId); }} onNavigate={async (id, type, target) => { setChecking(false); if (type === "entry") await show(id); else await onNavigatePage(id, target); }} onRepaired={onRepaired} />}
  </>;
}
type CheckIssue = { sourceType: "page" | "entry"; sourceId: string; title: string; notebookId: string; path: number[]; entryId: string; label: string; version: number; reason: string };
type CheckResult = { statistics: { entries: number; validReferences: number; invalidReferences: number; unreferencedEntries: number }; issues: CheckIssue[]; nameConflicts: string[] };
function ReferenceCheck({ onClose, beforeScan, onNavigate, onRepaired }: { onClose: () => void; beforeScan: () => Promise<void>; onNavigate: (id: string, type: "page" | "entry", target: string) => Promise<void>; onRepaired: Props["onRepaired"] }) {
  const [result, setResult] = useState<CheckResult | null>(null), [busy, setBusy] = useState(false), [issue, setIssue] = useState<CheckIssue | null>(null), [query, setQuery] = useState(""), [target, setTarget] = useState("");
  async function scan() { setBusy(true); try { await beforeScan(); setResult(await knowledgeRequest<CheckResult>("/api/knowledge/check", { method: "POST" })); setIssue(null); } catch (error) { notify.error(error instanceof Error ? error.message : "检查失败"); } finally { setBusy(false); } }
  async function repair(action: Record<string, unknown>) {
    if (!issue || busy) return; setBusy(true);
    try { await beforeScan(); await knowledgeRequest("/api/knowledge/repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: issue.sourceType, sourceId: issue.sourceId, version: issue.version, path: issue.path, entryId: issue.entryId, label: issue.label, ...action }) }); await onRepaired(issue.sourceId, issue.sourceType); refreshKnowledge(); setIssue(null); setResult(await knowledgeRequest<CheckResult>("/api/knowledge/check", { method: "POST" })); notify.success("已修复所选引用"); }
    catch (error) { notify.error(error instanceof Error ? error.message : "修复失败，请重新检查"); } finally { setBusy(false); }
  }
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="knowledge-dialog-overlay" /><Dialog.Content className="knowledge-check-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}><header className="modal-header"><Dialog.Title>数据管理 · 引用检查</Dialog.Title><button className="icon-button" aria-label="关闭引用检查" disabled={busy} onClick={onClose}><X size={17} /></button></header><Dialog.Description>按当前已保存正文检查引用；未被引用词条属于正常知识，不会自动删除。</Dialog.Description><div className="knowledge-controls"><button className="button-primary" disabled={busy} onClick={() => void scan()}>{busy ? "检查处理中…" : "开始检查"}</button><button className="button-outline" disabled={busy} onClick={() => void scan()}>重新构建引用关系</button></div>{result && <><dl className="knowledge-statistics"><div><dt>全部词条</dt><dd>{result.statistics.entries}</dd></div><div><dt>有效引用</dt><dd>{result.statistics.validReferences}</dd></div><div><dt>失效引用</dt><dd>{result.statistics.invalidReferences}</dd></div><div><dt>未被引用词条</dt><dd>{result.statistics.unreferencedEntries}</dd></div></dl>{result.nameConflicts.length > 0 && <p className="form-error">名称或别名冲突：{result.nameConflicts.join("、")}</p>}<div className="knowledge-check-results">{result.issues.map((item) => <div className="knowledge-check-issue" key={`${item.sourceType}:${item.sourceId}:${item.path.join(".")}`}><strong>{item.title}</strong><span>{item.reason} · @{item.label} · 位置 {item.path.join(".")}</span><button className="button-subtle" onClick={() => void onNavigate(item.sourceId, item.sourceType, item.entryId)}>定位来源</button><button className="button-outline" disabled={busy || !item.path.length} onClick={() => { setIssue(item); setQuery(item.label); setTarget(""); }}>修复此处引用</button></div>)}{!result.issues.length && <p className="status-line">未发现失效引用</p>}</div></>}{issue && <section className="knowledge-repair"><h2 className="text-ui-heading">修复 @{issue.label}</h2><p>仅修改 {issue.title} 中位置 {issue.path.join(".")} 的引用。</p><input className="control-input" aria-label="搜索修复目标词条" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="control-input" aria-label="重新关联词条" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">选择已有词条</option>{getKnowledgeCatalog().filter((entry) => [entry.title, ...entry.aliases].some((name) => normalizeKnowledgeName(name).includes(normalizeKnowledgeName(query)))).map((entry) => <option value={entry.id} key={entry.id}>{entry.title}</option>)}</select><div className="knowledge-controls"><button className="button-outline" disabled={busy || !target} onClick={() => void repair({ targetId: target })}>重新关联</button><button className="button-outline" disabled={busy || !query.trim()} onClick={() => void repair({ createTitle: query.trim() })}>创建词条并重新关联</button><button className="button-outline" disabled={busy} onClick={() => void repair({ asText: true })}>转换为普通文字</button></div></section>}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
