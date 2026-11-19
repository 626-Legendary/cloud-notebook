"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LibraryBig, Download, FileUp, Plus, Search } from "lucide-react";
import { getKnowledgeCatalog, subscribeKnowledge, knowledgeRequest, type KnowledgeSummary } from "@/lib/knowledge-client";
import { useFormDialog } from "@/components/ui/dialog";
import { notify } from "@/lib/notifications";

export const refreshKnowledge = () => window.dispatchEvent(new Event("cloud-notebook:knowledge-change"));
export const openKnowledge = (id: string) => window.dispatchEvent(new CustomEvent("cloud-notebook:knowledge-open", { detail: { id } }));
export async function downloadKnowledgeFile(url: string, fallback: string) {
  const response = await fetch(url); if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? "导出失败"); }
  const blob = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = blob; link.download = fallback; link.click(); setTimeout(() => URL.revokeObjectURL(blob), 30_000);
}
export function KnowledgeLibrary({ onImport }: { onImport: (file: File) => void }) {
  const entries = useSyncExternalStore(subscribeKnowledge, getKnowledgeCatalog, getKnowledgeCatalog);
  const [searchResults, setSearchResults] = useState<KnowledgeSummary[]>([]);
  const [query, setQuery] = useState(""), [sort, setSort] = useState("updated"), [busy, setBusy] = useState(false);
  const ask = useFormDialog();
  async function create() {
    const result = await ask({ title: "新建词条", submitLabel: "创建词条", fields: [{ name: "title", label: "正式名称", required: true, maxLength: 120 }, { name: "aliases", label: "别名（用逗号分隔）", required: false, maxLength: 1000 }] });
    if (!result || busy) return; setBusy(true);
    try { const data = await knowledgeRequest<{ entry: KnowledgeSummary }>("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: result.values.title, aliases: result.values.aliases.split(/[,，、\n]/).map((name) => name.trim()).filter(Boolean) }) }); refreshKnowledge(); openKnowledge(data.entry.id); }
    catch (error) { notify.error(error instanceof Error ? error.message : "无法创建词条"); } finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void knowledgeRequest<{ entries: KnowledgeSummary[] }>(`/api/knowledge?q=${encodeURIComponent(query)}&sort=${sort}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setSearchResults(data.entries); }).catch((error: unknown) => { if (!controller.signal.aborted) notify.error(error instanceof Error ? error.message : "搜索失败"); }); }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, sort, entries]);
  const visible = [...searchResults]
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  return <section className="knowledge-library">
    <header className="knowledge-library-heading"><h1 className="text-ui-title"><LibraryBig size={22} />知识库</h1><div className="knowledge-controls"><label className="button-outline knowledge-import"><FileUp size={15} />导入知识库<input type="file" accept=".cnf" aria-label="导入知识库文件" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onImport(file); }} /></label><button className="button-outline" type="button" onClick={() => void downloadKnowledgeFile("/api/knowledge/cnf", "知识库.cnf").catch((error: unknown) => notify.error(error instanceof Error ? error.message : "导出失败"))}><Download size={15} />导出知识库</button><button className="button-primary" type="button" disabled={busy} onClick={() => void create()}><Plus size={15} />新建词条</button></div></header>
    <p className="text-ui-secondary">独立积累知识，使用 @ 在页面和词条之间建立关联。</p>
    <div className="knowledge-controls"><label className="knowledge-search"><Search size={15} /><input className="control-input" aria-label="搜索知识库" placeholder="搜索正式名称、别名或正文" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select className="control-input" aria-label="词条排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">修改时间</option><option value="created">创建时间</option><option value="title">名称</option></select></div>
    <div className="knowledge-entry-list">{visible.map((entry) => <button type="button" className="knowledge-entry-row" key={entry.id} onClick={() => openKnowledge(entry.id)}><strong>{entry.title}</strong><p>{entry.summary || "暂无正文"}</p><div><time>{new Date(entry.updatedAt).toLocaleString("zh-CN")}</time></div></button>)}{!visible.length && <p className="status-line">{entries.length ? "没有匹配词条" : "知识库为空，可以新建词条或在正文输入 @"}</p>}</div>
  </section>;
}
