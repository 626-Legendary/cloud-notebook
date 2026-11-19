"use client";
import { useEffect, useState } from "react";
import { BookOpenText, ChevronLeft, ChevronRight, Search } from "lucide-react";
type Entry = { id: string; title: string; username: string; aliases: string[]; updatedAt: string; deletedAt: string | null };
type Result = { entries: Entry[]; total: number; page: number; pages: number };
export default function AdminKnowledgePage() {
  const [query, setQuery] = useState(""), [status, setStatus] = useState("active"), [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError("");
      void fetch(`/api/admin/knowledge?q=${encodeURIComponent(query)}&status=${status}&page=${page}`, { signal: controller.signal }).then(async (response) => {
        const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "读取失败"); if (!controller.signal.aborted) setData(result);
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取失败"); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    },180);
    return () => { clearTimeout(timer); controller.abort(); };
  },[query,status,page]);
  return <>
    <h1 className="admin-title">知识库管理</h1><p className="admin-description">查看词条所属用户、名称、别名和状态。用户正文保留在其工作空间中。</p>
    <section className="admin-section admin-knowledge-section" aria-busy={busy}>
      <div className="admin-knowledge-filters"><label className="knowledge-search"><Search size={16} /><input type="search" aria-label="搜索管理词条" placeholder="搜索词条、别名或用户名" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); setBusy(true); }} /></label><select className="control-input" aria-label="词条状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setBusy(true); }}><option value="active">正常词条</option><option value="trash">回收站词条</option></select></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="status-line" role="status">{busy ? "正在读取…" : `共 ${data?.total ?? 0} 个词条`}</p>
      <div className="admin-knowledge-list">{data?.entries.map((entry) => <article className="admin-knowledge-row" key={entry.id}><BookOpenText size={20} /><div><strong title={entry.title}>{entry.title}</strong><p title={entry.aliases.join("、")}>{entry.aliases.length ? entry.aliases.join(" · ") : "未设置别名"}</p><span>所属用户：{entry.username}</span></div><div><span className={`admin-entry-status${entry.deletedAt ? " is-deleted" : ""}`}>{entry.deletedAt ? "已删除" : "正常"}</span><time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleDateString("zh-CN")}</time></div></article>)}</div>
      {!busy && !data?.entries.length && !error && <div className="knowledge-empty"><BookOpenText size={32} /><p>没有匹配的词条</p></div>}
      <div className="admin-knowledge-pagination"><span>第 {data?.page ?? 1} / {data?.pages ?? 1} 页</span><button className="button-outline" aria-label="上一页词条" disabled={busy || !data || data.page <= 1} onClick={() => { setPage((data?.page ?? 1)-1); setBusy(true); }}><ChevronLeft size={15} />上一页</button><button className="button-outline" aria-label="下一页词条" disabled={busy || !data || data.page >= data.pages} onClick={() => { setPage((data?.page ?? 1)+1); setBusy(true); }}>下一页<ChevronRight size={15} /></button></div>
    </section>
  </>;
}
