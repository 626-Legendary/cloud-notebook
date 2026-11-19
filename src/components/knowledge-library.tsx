"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LibraryBig, BookOpenText, Plus, Search, ArrowDownWideNarrow, DatabaseArrowDown, DatabaseArrowUp } from "lucide-react";
import { getKnowledgeCatalog, subscribeKnowledge, knowledgeRequest, type KnowledgeSummary } from "@/lib/knowledge-client";
import { useFormDialog } from "@/components/ui/dialog";
import { notify } from "@/lib/notifications";

export const refreshKnowledge = () => window.dispatchEvent(new Event("cloud-notebook:knowledge-change"));
export const openKnowledge = (id: string, editing = false) => window.dispatchEvent(new CustomEvent("cloud-notebook:knowledge-open", { detail: { id, editing } }));
export async function downloadKnowledgeFile(url: string, fallback: string) {
  const response = await fetch(url); if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? "导出失败"); }
  const blob = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = blob; link.download = fallback; link.click(); setTimeout(() => URL.revokeObjectURL(blob), 30_000);
}
export function KnowledgeLibrary({ onImport }: { onImport: (file: File) => void }) {
  const entries = useSyncExternalStore(subscribeKnowledge, getKnowledgeCatalog, getKnowledgeCatalog);
  const [searchResults, setSearchResults] = useState<KnowledgeSummary[]>([]);
  const [query, setQuery] = useState(""), [sort, setSort] = useState("updated"), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), [loading, setLoading] = useState(true);
  const ask = useFormDialog();
  async function create() {
    const result = await ask({ title: "新建词条", submitLabel: "创建词条", fields: [{ name: "title", label: "正式名称", required: true, maxLength: 120 }, { name: "aliases", label: "别名（用逗号分隔）", required: false, maxLength: 1000 }] });
    if (!result || busy) return; setBusy(true);
    try { const data = await knowledgeRequest<{ entry: KnowledgeSummary }>("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: result.values.title, aliases: result.values.aliases.split(/[,，、\n]/).map((name) => name.trim()).filter(Boolean) }) }); refreshKnowledge(); openKnowledge(data.entry.id, true); }
    catch (error) { notify.error(error instanceof Error ? error.message : "无法创建词条"); } finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { setLoading(true); void knowledgeRequest<{ entries: KnowledgeSummary[] }>(`/api/knowledge?q=${encodeURIComponent(query)}&sort=${sort}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setSearchResults(data.entries); }).catch((error: unknown) => { if (!controller.signal.aborted) notify.error(error instanceof Error ? error.message : "搜索失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, sort, entries]);
  const visible = [...searchResults]
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  async function exportLibrary() {
    if (exporting) return;
    setExporting(true);
    try { await downloadKnowledgeFile("/api/knowledge/cnf", "知识库.cnf"); }
    catch (error) { notify.error(error instanceof Error ? error.message : "导出失败"); }
    finally { setExporting(false); }
  }
  return <section className="knowledge-library" aria-label="知识库">
    <header className="knowledge-library-heading">
      <div className="knowledge-library-title"><h1 className="text-ui-title"><LibraryBig size={24} />知识库</h1><p className="text-ui-secondary">记录独立知识，在笔记中用 @ 建立关联。</p></div>
      <div className="knowledge-library-actions">
        <label className="button-outline knowledge-import"><DatabaseArrowUp size={16} />导入知识库<input type="file" accept=".cnf" aria-label="导入知识库文件" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onImport(file); }} /></label>
        <button className="button-outline" type="button" disabled={exporting} onClick={() => void exportLibrary()}><DatabaseArrowDown size={16} />{exporting ? "正在导出…" : "导出知识库"}</button>
        <button className="button-primary" type="button" disabled={busy} onClick={() => void create()}><Plus size={16} />新建词条</button>
      </div>
    </header>
    <div className="knowledge-library-filters">
      <label className="knowledge-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="搜索知识库" placeholder="搜索名称、别名或正文" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="knowledge-sort"><ArrowDownWideNarrow size={16} aria-hidden="true" /><select aria-label="词条排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">最近修改</option><option value="created">最近创建</option><option value="title">名称排序</option></select></label>
    </div>
    <div className="knowledge-list-caption"><span>{query ? "搜索结果" : "全部词条"} · {visible.length}</span><span role="status">{loading ? "正在查找…" : ""}</span></div>
    <div className="knowledge-entry-list" aria-busy={loading}>
      {visible.map((entry) => <button type="button" className="knowledge-entry-row" key={entry.id} aria-label={`打开词条：${entry.title}`} onClick={() => openKnowledge(entry.id)}>
        <span className="knowledge-entry-icon"><BookOpenText size={19} /></span>
        <span className="knowledge-entry-main"><strong title={entry.title}>{entry.title}</strong><span className="knowledge-entry-summary">{entry.summary || "暂无内容"}</span>{entry.aliases.length > 0 && <span className="knowledge-entry-aliases" title={entry.aliases.join("、")}>{entry.aliases.join(" · ")}</span>}</span>
        <time dateTime={entry.updatedAt} title="最后修改时间">{new Date(entry.updatedAt).toLocaleDateString("zh-CN")}</time>
      </button>)}
      {!loading && !visible.length && <div className="knowledge-empty"><LibraryBig size={36} /><h2 className="text-ui-heading">{query ? "没有匹配的词条" : "从一个词条开始"}</h2><p>{query ? "试试其他名称、别名或关键词。" : "可以记录简短定义，也可以写一篇完整的知识文章。"}</p>{!entries.length && <button className="button-primary" onClick={() => void create()} disabled={busy}><Plus size={16} />创建第一个词条</button>}</div>}
    </div>
  </section>;
}
