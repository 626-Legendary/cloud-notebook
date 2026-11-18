"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BookOpen, Download, Plus, Search, Tags } from "lucide-react";
import { getKnowledgeCatalog, subscribeKnowledge, knowledgeRequest, type KnowledgeSummary } from "@/lib/knowledge-client";
import { useFormDialog } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/alert-dialog";
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
  const [query, setQuery] = useState(""), [sort, setSort] = useState("updated"), [tag, setTag] = useState(""), [manageTags, setManageTags] = useState(false), [busy, setBusy] = useState(false);
  const ask = useFormDialog();
  async function create() {
    const result = await ask({ title: "新建词条", submitLabel: "创建词条", fields: [{ name: "title", label: "正式名称", required: true, maxLength: 120 }, { name: "aliases", label: "别名（用逗号分隔）", required: false, maxLength: 1000 }] });
    if (!result || busy) return; setBusy(true);
    try { const data = await knowledgeRequest<{ entry: KnowledgeSummary }>("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: result.values.title, aliases: result.values.aliases.split(/[,，、\n]/).map((name) => name.trim()).filter(Boolean) }) }); refreshKnowledge(); openKnowledge(data.entry.id); }
    catch (error) { notify.error(error instanceof Error ? error.message : "无法创建词条"); } finally { setBusy(false); }
  }
  const tagOptions = [...new Map(entries.flatMap((entry) => entry.tags).map((item) => [item.id, item])).values()];
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void knowledgeRequest<{ entries: KnowledgeSummary[] }>(`/api/knowledge?q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}&sort=${sort}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setSearchResults(data.entries); }).catch((error: unknown) => { if (!controller.signal.aborted) notify.error(error instanceof Error ? error.message : "搜索失败"); }); }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, tag, sort, entries]);
  const visible = searchResults.filter((entry) => !tag || entry.tags.some((item) => item.id === tag))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  return <section className="knowledge-library">
    <header className="knowledge-library-heading"><h1 className="text-ui-title"><BookOpen size={22} />知识库</h1><div className="knowledge-controls"><label className="button-outline knowledge-import">导入知识库<input type="file" accept=".cnf" aria-label="导入知识库文件" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onImport(file); }} /></label><button className="button-outline" type="button" onClick={() => setManageTags((value) => !value)}><Tags size={15} />管理标签</button><button className="button-outline" type="button" onClick={() => void downloadKnowledgeFile("/api/knowledge/cnf", "知识库.cnf").catch((error: unknown) => notify.error(error instanceof Error ? error.message : "导出失败"))}><Download size={15} />导出知识库</button><button className="button-primary" type="button" disabled={busy} onClick={() => void create()}><Plus size={15} />新建词条</button></div></header>
    <p className="text-ui-secondary">独立积累知识，使用 @ 在页面和词条之间建立关联。</p>
    {manageTags && <TagManager />}
    <div className="knowledge-controls"><label className="knowledge-search"><Search size={15} /><input className="control-input" aria-label="搜索知识库" placeholder="搜索正式名称、别名或正文" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select className="control-input" aria-label="词条排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">修改时间</option><option value="created">创建时间</option><option value="title">名称</option></select><select className="control-input" aria-label="词条标签筛选" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">全部标签</option>{tagOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <div className="knowledge-entry-list">{visible.map((entry) => <button type="button" className="knowledge-entry-row" key={entry.id} onClick={() => openKnowledge(entry.id)}><strong>{entry.title}</strong><p>{entry.summary || "暂无正文"}</p><div>{entry.tags.map((item) => <span className="knowledge-tag" key={item.id}>{item.name}</span>)}<time>{new Date(entry.updatedAt).toLocaleString("zh-CN")}</time></div></button>)}{!visible.length && <p className="status-line">{entries.length ? "没有匹配词条" : "知识库为空，可以新建词条或在正文输入 @"}</p>}</div>
  </section>;
}
export function TagManager() {
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]), [name, setName] = useState(""), [busy, setBusy] = useState(false);
  const ask = useFormDialog(), confirm = useConfirm();
  useEffect(() => { const controller = new AbortController(); void knowledgeRequest<{ tags: typeof tags }>("/api/tags", { signal: controller.signal }).then((data) => setTags(data.tags)).catch(() => {}); return () => controller.abort(); }, []);
  async function act(action: Record<string, unknown>) {
    if (busy) return; setBusy(true);
    try { const data = await knowledgeRequest<{ tags: typeof tags }>("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }); setTags(data.tags); setName(""); window.dispatchEvent(new Event("cloud-notebook:tags-change")); refreshKnowledge(); }
    catch (error) { notify.error(error instanceof Error ? error.message : "标签操作失败"); } finally { setBusy(false); }
  }
  return <section className="knowledge-tag-manager"><h2 className="text-ui-heading">全局标签</h2><div className="knowledge-controls"><input className="control-input" aria-label="创建全局标签" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /><button className="button-outline" disabled={busy || !name.trim()} onClick={() => void act({ action: "create", name: name.trim() })}>新建标签</button></div>{tags.map((tag) => <div className="knowledge-controls" key={tag.id}><span>{tag.name}</span><button className="button-subtle" disabled={busy} onClick={() => void ask({ title: "重命名标签", fields: [{ name: "name", label: "标签名称", value: tag.name, required: true, maxLength: 60 }] }).then((result) => { if (result) void act({ action: "rename", id: tag.id, name: result.values.name }); })}>重命名</button><select className="control-input" aria-label={`合并标签${tag.name}`} defaultValue="" disabled={busy} onChange={(event) => { const targetId = event.target.value; event.target.value = ""; if (targetId) void confirm("将此标签的全部关联转移到目标标签，继续？", "合并标签").then((accepted) => { if (accepted) void act({ action: "merge", id: tag.id, targetId }); }); }}><option value="">合并到…</option>{tags.filter((item) => item.id !== tag.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="button-subtle destructive" disabled={busy} onClick={() => void confirm("删除标签只移除标签关联，不删除页面或词条。继续？", "删除标签").then((accepted) => { if (accepted) void act({ action: "delete", id: tag.id }); })}>删除</button></div>)}</section>;
}
