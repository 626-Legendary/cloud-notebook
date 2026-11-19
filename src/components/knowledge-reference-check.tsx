"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, ClipboardCheck, FileText, LibraryBig, LoaderCircle, RefreshCw, SearchCheck, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { normalizeKnowledgeName } from "@/lib/knowledge-document";
import { getKnowledgeCatalog, knowledgeRequest } from "@/lib/knowledge-client";
import { refreshKnowledge } from "@/components/knowledge-library";
import { notify } from "@/lib/notifications";

type CheckIssue = { sourceType: "page" | "entry"; sourceId: string; title: string; notebookId: string; path: number[]; entryId: string; label: string; version: number; reason: string };
type CheckResult = { statistics: { entries: number; validReferences: number; invalidReferences: number; unreferencedEntries: number }; issues: CheckIssue[]; nameConflicts: string[] };
type Props = {
  onClose: () => void;
  beforeScan: () => Promise<void>;
  onNavigate: (id: string, type: "page" | "entry", target: string) => Promise<void>;
  onRepaired: (id: string, type: "page" | "entry") => Promise<void>;
};

export function ReferenceCheck({ onClose, beforeScan, onNavigate, onRepaired }: Props) {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<CheckIssue | null>(null);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const repairPanel = useRef<HTMLElement>(null);
  useEffect(() => { repairPanel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [issue]);

  async function scan() {
    if (busy) return;
    setBusy(true);
    try { await beforeScan(); setResult(await knowledgeRequest<CheckResult>("/api/knowledge/check", { method: "POST" })); setIssue(null); }
    catch (error) { notify.error(error instanceof Error ? error.message : "检查失败"); }
    finally { setBusy(false); }
  }

  async function repair(action: Record<string, unknown>) {
    if (!issue || busy) return;
    setBusy(true);
    try {
      await beforeScan();
      await knowledgeRequest("/api/knowledge/repair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: issue.sourceType, sourceId: issue.sourceId, version: issue.version, path: issue.path, entryId: issue.entryId, label: issue.label, ...action })
      });
      await onRepaired(issue.sourceId, issue.sourceType);
      refreshKnowledge(); setIssue(null);
      setResult(await knowledgeRequest<CheckResult>("/api/knowledge/check", { method: "POST" }));
      notify.success("已修复所选引用");
    } catch (error) { notify.error(error instanceof Error ? error.message : "修复失败，请重新检查"); }
    finally { setBusy(false); }
  }

  const statistics = [
    { label: "全部词条", value: result?.statistics.entries },
    { label: "有效引用", value: result?.statistics.validReferences },
    { label: "失效引用", value: result?.statistics.invalidReferences, warning: Boolean(result?.statistics.invalidReferences) },
    { label: "未被引用", value: result?.statistics.unreferencedEntries }
  ];
  const targets = getKnowledgeCatalog().filter((entry) => [entry.title, ...entry.aliases].some((name) => normalizeKnowledgeName(name).includes(normalizeKnowledgeName(query))));

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="knowledge-dialog-overlay" />
    <Dialog.Content className="knowledge-check-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <header className="knowledge-check-header">
        <span className="knowledge-check-icon"><ClipboardCheck size={22} /></span>
        <div><Dialog.Title className="text-ui-heading">数据管理 · 引用检查</Dialog.Title><Dialog.Description>查找失效关联，修复笔记与知识之间的引用。</Dialog.Description></div>
        <button className="icon-button" aria-label="关闭引用检查" disabled={busy} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="knowledge-check-scroll" aria-busy={busy}>
        <dl className="knowledge-statistics">{statistics.map((stat) => <div key={stat.label} data-warning={stat.warning || undefined}><dt>{stat.label}</dt><dd>{stat.value?.toLocaleString("zh-CN") ?? "—"}</dd></div>)}</dl>
        <div className="knowledge-check-toolbar"><p>检查当前已保存的内容</p><div className="knowledge-controls">
          <button className="button-outline" disabled={busy} onClick={() => void scan()}><RefreshCw size={15} />重新构建引用关系</button>
          <button className="button-primary" disabled={busy} onClick={() => void scan()}>{busy ? <LoaderCircle size={15} className="spin" /> : <SearchCheck size={15} />}{busy ? "检查处理中…" : "开始检查"}</button>
        </div></div>
        {result && result.nameConflicts.length > 0 && <div className="knowledge-check-warning" role="alert"><TriangleAlert size={18} /><div><strong>名称或别名需要处理</strong><p>{result.nameConflicts.join("、")}</p></div></div>}
        <div className={`knowledge-check-layout${issue ? " has-repair" : ""}`}>
          <section className="knowledge-check-results" aria-label="引用检查结果">
            {result && result.issues.length > 0 ? <><h2 className="text-ui-body">需要处理的引用 <span>{result.issues.length}</span></h2>{result.issues.map((item) => {
              const id = `${item.sourceType}:${item.sourceId}:${item.path.join(".")}`;
              const selected = issue?.sourceId === item.sourceId && issue?.sourceType === item.sourceType && issue.path.join(".") === item.path.join(".");
              return <div className="knowledge-check-issue" key={id} data-selected={selected || undefined}>
                <div className="knowledge-issue-source">{item.sourceType === "page" ? <FileText size={16} /> : <LibraryBig size={16} />}<strong title={item.title}>{item.title}</strong><span>{item.sourceType === "page" ? "页面" : "词条"}</span></div>
                <p className="knowledge-issue-label" title={`@${item.label}`}>@{item.label}</p><p className="knowledge-issue-reason">{item.reason}</p>
                <div className="knowledge-issue-actions"><button className="button-subtle" disabled={busy} onClick={() => void onNavigate(item.sourceId, item.sourceType, item.entryId)}>定位来源</button><button className="button-outline" disabled={busy || !item.path.length} onClick={() => { setIssue(item); setQuery(item.label); setTarget(""); }}>修复此处引用</button></div>
              </div>;
            })}</> : <div className="knowledge-empty knowledge-check-empty">{result ? <CheckCircle2 size={36} /> : <SearchCheck size={36} />}<h2 className="text-ui-body">{result ? "未发现失效引用" : "尚未开始检查"}</h2><p>{result ? "现有引用可以正常访问，未被引用的词条也会保留。" : "点击开始检查，查看需要处理的引用。"}</p></div>}
          </section>
          {issue && <aside ref={repairPanel} className="knowledge-repair" aria-label="修复引用">
            <header><h2 className="text-ui-body">修复所选引用</h2><button className="icon-button" aria-label="取消修复" disabled={busy} onClick={() => setIssue(null)}><X size={16} /></button></header>
            <div className="knowledge-repair-context"><strong title={`@${issue.label}`}>@{issue.label}</strong><p>来自 {issue.title}</p></div>
            <label className="knowledge-field">查找词条或输入新名称<input className="control-input" aria-label="搜索修复目标词条" disabled={busy} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="knowledge-field">关联已有词条<select className="control-input" aria-label="重新关联词条" disabled={busy} value={target} onChange={(event) => setTarget(event.target.value)}><option value="">选择目标词条</option>{targets.map((entry) => <option value={entry.id} key={entry.id}>{entry.title}</option>)}</select></label>
            <div className="knowledge-repair-actions"><button className="button-primary" disabled={busy || !target} onClick={() => void repair({ targetId: target })}>重新关联</button><button className="button-outline" disabled={busy || !query.trim()} onClick={() => void repair({ createTitle: query.trim() })}>创建词条并重新关联</button><button className="button-subtle" disabled={busy} onClick={() => void repair({ asText: true })}>转换为普通文字</button></div>
          </aside>}
        </div>
      </div>
      <footer className="knowledge-check-footer"><ShieldCheck size={15} />每次只修复选中的一处引用，未引用词条不会自动删除。</footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
