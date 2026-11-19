"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, ClipboardCheck, FileText, LibraryBig, LoaderCircle, SearchCheck, ArrowLeft, ShieldCheck, TriangleAlert, X } from "lucide-react";
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
  const [mode, setMode] = useState<"link" | "create" | "text">("link");
  const [error, setError] = useState("");

  async function scan() {
    if (busy) return;
    setBusy(true); setError("");
    try { await beforeScan(); setResult(await knowledgeRequest<CheckResult>("/api/knowledge/check", { method: "POST" })); setIssue(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "检查失败，请重试"); }
    finally { setBusy(false); }
  }

  async function repair(action: Record<string, unknown>) {
    if (!issue || busy) return;
    setBusy(true); setError("");
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "修复失败，请重新检查"); }
    finally { setBusy(false); }
  }

  const statistics = [
    { label: "全部词条", value: result?.statistics.entries },
    { label: "有效引用", value: result?.statistics.validReferences },
    { label: "失效引用", value: result?.statistics.invalidReferences, warning: Boolean(result?.statistics.invalidReferences) },
    { label: "未被引用", value: result?.statistics.unreferencedEntries }
  ];
  const targets = getKnowledgeCatalog().filter((entry) => [entry.title, ...entry.aliases].some((name) => normalizeKnowledgeName(name).includes(normalizeKnowledgeName(query))));

  const duplicateName = getKnowledgeCatalog().some((entry) => [entry.title, ...entry.aliases].some((name) => normalizeKnowledgeName(name) === normalizeKnowledgeName(query)));
  const canRepair = mode === "link" ? Boolean(target) : mode === "create" ? Boolean(query.trim()) && !duplicateName && query.trim().length <= 120 : true;
  function leaveRepair() { setIssue(null); setError(""); }
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="knowledge-dialog-overlay" />
    <Dialog.Content className="knowledge-check-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <header className="knowledge-check-header"><span className="knowledge-check-icon"><ClipboardCheck size={22} /></span><div><Dialog.Title className="text-ui-heading">数据管理 · 引用检查</Dialog.Title><Dialog.Description>{issue ? "选择修复方式，仅修改这一处引用。" : "检查笔记与词条的关联，处理无法访问的目标。"}</Dialog.Description></div><button className="icon-button" aria-label="关闭引用检查" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="knowledge-check-scroll" aria-busy={busy}>
        {error && <p className="knowledge-check-error" role="alert">{error}</p>}
        {issue ? <section className="knowledge-repair" aria-label="修复引用">
          <button className="button-subtle knowledge-repair-back" disabled={busy} onClick={leaveRepair}><ArrowLeft size={15} />返回检查结果</button>
          <div className="knowledge-repair-context"><span className="text-ui-caption">{issue.sourceType === "page" ? "来源页面" : "来源词条"} · {issue.title}</span><strong title={`@${issue.label}`}>@{issue.label}</strong><p>{issue.reason}</p></div>
          <form id="knowledge-repair-form" onSubmit={(event) => { event.preventDefault(); if (canRepair) void repair(mode === "link" ? { targetId: target } : mode === "create" ? { createTitle: query.trim() } : { asText: true }); }}>
            <fieldset className="knowledge-repair-modes" disabled={busy}><legend>如何处理这处引用？</legend>
              {([{ value: "link", title: "关联已有词条", description: "保留引用，改为指向选中的词条。" }, { value: "create", title: "创建新词条", description: "创建目标词条，再关联这处引用。" }, { value: "text", title: "转换为普通文字", description: "保留显示文字，移除这处引用关系。" }] as const).map((option) => <label key={option.value} data-selected={mode === option.value || undefined}><input type="radio" aria-label={option.title} aria-describedby={`repair-${option.value}-description`} name="repair-mode" value={option.value} checked={mode === option.value} onChange={() => { setMode(option.value); setTarget(""); setError(""); }} /><span><strong>{option.title}</strong><span id={`repair-${option.value}-description`}>{option.description}</span></span></label>)}
            </fieldset>
            {mode === "link" && <div className="knowledge-repair-fields"><label className="knowledge-field">搜索名称或别名<input className="control-input" aria-label="搜索修复目标词条" disabled={busy} value={query} onChange={(event) => { setQuery(event.target.value); setTarget(""); }} /></label><label className="knowledge-field">选择目标词条<select className="control-input" aria-label="重新关联词条" disabled={busy} required value={target} onChange={(event) => setTarget(event.target.value)}><option value="">请选择目标词条</option>{targets.map((entry) => <option value={entry.id} key={entry.id}>{entry.title}</option>)}</select></label>{!targets.length && <p className="knowledge-repair-hint">没有匹配词条，可切换为创建新词条或保留普通文字。</p>}</div>}
            {mode === "create" && <label className="knowledge-field">新词条名称<input className="control-input" aria-label="新词条名称" disabled={busy} required maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} />{duplicateName && <span className="knowledge-repair-hint">名称或别名已存在，请选择关联已有词条。</span>}</label>}
            {mode === "text" && <p className="knowledge-repair-hint">转换后显示文字保持不变。其他位置的引用不会受到影响。</p>}
          </form>
        </section> : <>
          <dl className="knowledge-statistics">{statistics.map((stat) => <div key={stat.label} data-warning={stat.warning || undefined}><dt>{stat.label}</dt><dd>{stat.value?.toLocaleString("zh-CN") ?? "—"}</dd></div>)}</dl>
          <div className="knowledge-check-toolbar"><p>未引用的词条属于正常内容，不会自动删除。</p><button className="button-primary" disabled={busy} onClick={() => void scan()}>{busy ? <LoaderCircle size={15} className="spin" /> : <SearchCheck size={15} />}{busy ? "检查中…" : result ? "重新检查" : "开始检查"}</button></div>
          {result && result.nameConflicts.length > 0 && <div className="knowledge-check-warning" role="alert"><TriangleAlert size={18} /><div><strong>名称或别名需要处理</strong><p>{result.nameConflicts.join("、")}</p></div></div>}
          <section className="knowledge-check-results" aria-label="引用检查结果">
            {result && result.issues.length > 0 ? <><h2 className="text-ui-body">需要处理的引用 <span>{result.issues.length}</span></h2>{result.issues.map((item) => <div className="knowledge-check-issue" key={`${item.sourceType}:${item.sourceId}:${item.path.join(".")}`}>
              <div className="knowledge-issue-source">{item.sourceType === "page" ? <FileText size={16} /> : <LibraryBig size={16} />}<strong title={item.title}>{item.title}</strong><span>{item.sourceType === "page" ? "页面" : "词条"}</span></div><p className="knowledge-issue-label" title={`@${item.label}`}>@{item.label}</p><p className="knowledge-issue-reason">{item.reason}</p>
              <div className="knowledge-issue-actions"><button className="button-subtle" disabled={busy} onClick={() => void onNavigate(item.sourceId, item.sourceType, item.entryId)}>定位来源</button><button className="button-outline" disabled={busy || !item.path.length} onClick={() => { setIssue(item); setMode("link"); setQuery(item.label.slice(0,120)); setTarget(""); setError(""); }}>修复此处引用</button></div>
            </div>)}</> : <div className="knowledge-empty knowledge-check-empty">{result ? <CheckCircle2 size={36} /> : <SearchCheck size={36} />}<h2 className="text-ui-body">{result ? "未发现失效引用" : "检查你的知识关联"}</h2><p>{result ? "现有引用可以正常访问。" : "扫描已保存的页面和词条，查看需要处理的引用。"}</p></div>}
          </section>
        </>}
      </div>
      <footer className={`knowledge-check-footer${issue ? " is-repairing" : ""}`}>{issue ? <><button className="button-outline" aria-label="取消修复" disabled={busy} onClick={leaveRepair}>取消</button><button className="button-primary" form="knowledge-repair-form" type="submit" disabled={busy || !canRepair}>{busy ? <LoaderCircle className="spin" size={15} /> : null}确认修复</button></> : <><span><ShieldCheck size={15} />检查只读取已保存的内容。</span><button className="button-outline" disabled={busy} onClick={onClose}>完成</button></>}</footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
