"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, CheckSquare, HardDrive, RefreshCw, ScanSearch, Trash2, ImageOff } from "lucide-react";
import { isAssetCleanupCandidate } from "@/lib/asset-references";
import { useConfirm } from "@/components/ui/alert-dialog";

type AssetStatus = "orphan" | "grace-period" | "referenced" | "unknown" | "file-missing";
type AssetItem = {
  id: string; userId: string; username: string; fileName: string; originalName: string;
  mimeType: string; uploadedAt: string; size: number; referenceCount: number;
  currentPageReferences: number; snapshotReferences: number; notebookCoverReferences: number; trashResourceReferences: number;
  status: AssetStatus; reason: string;
};
type ScanResult = {
  summary: {
    totalImages: number; totalStorageBytes: number; referencedImages: number;
    orphanCandidates: number; reclaimableBytes: number; unknownFiles: number;
    pendingQuarantine: number; scanComplete: boolean;
  };
  candidates: AssetItem[];
  untrackedFiles: { name: string; size: number; modifiedAt: string; type: string }[];
  totalCandidates: number;
  totalCandidateBytes: number;
  totalItems: number;
  graceHours: number;
};
type AdminUser = { id: string; username: string };
const PAGE_SIZE = 50;

export default function AdminAssetsPage() {
  const confirm = useConfirm();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterUser, setFilterUser] = useState("");
  const [sortBy, setSortBy] = useState<"uploadedAt" | "size" | "username">("uploadedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const scan = useCallback(async (nextOffset: number, filter: string, sort: typeof sortBy, order: typeof direction) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/assets/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: nextOffset, limit: PAGE_SIZE, userId: filter || undefined,
          sortBy: sort, direction: order
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "扫描图片失败");
      setResult(data as ScanResult);
      setOffset(nextOffset);
      setSelectedIds(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "扫描图片失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/admin/users");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "无法加载用户列表");
        if (!cancelled) setUsers(data.users.map(({ id, username }: AdminUser) => ({ id, username })));
        if (!cancelled) await scan(0, "", "uploadedAt", "desc");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载图片存储");
      }
    }
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scan]);

  const pageOrphans = useMemo(() => result?.candidates.filter((item) => isAssetCleanupCandidate(item.status)) ?? [], [result]);
  const selectedBytes = useMemo(() => pageOrphans.filter((item) => selectedIds.has(item.id)).reduce((sum, item) => sum + (item.status === "file-missing" ? 0 : item.size), 0), [pageOrphans, selectedIds]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCurrentCandidates() {
    setSelectedIds((current) => current.size === pageOrphans.length
      ? new Set()
      : new Set(pageOrphans.map((item) => item.id)));
  }

  async function cleanup(ids: string[], recoverOnly = false) {
    if (!ids.length && !recoverOnly) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/assets/cleanup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: ids })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "清理图片失败");
      setNotice(`已清理 ${data.deleted} 条记录（缺失文件记录 ${data.missingRecords ?? 0} 条），实际释放 ${formatSize(data.reclaimedBytes)}。${data.failures.length ? ` ${data.failures.length} 项未能清理，可重新扫描后重试。` : ""}`);
      await scan(0, filterUser, sortBy, direction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理图片失败");
    } finally {
      setBusy(false);
    }
  }

  async function cleanupAll() {
    const total = result?.totalCandidates ?? 0;
    const bytes = result?.totalCandidateBytes ?? 0;
    if (!total || !await confirm(`将重新检查并清理最多 ${total} 条安全候选记录（含无引用的缺失文件记录），预计释放 ${formatSize(bytes)}。仍被引用或处于宽限期的完整图片会保留，缺失文件记录清理不释放磁盘空间。继续吗？`, "清理全部冗余图片")) return;
    setBusy(true);
    setError("");
    setNotice("");
    let deleted = 0;
    let reclaimed = 0;
    let failed = 0;
    let reachedBatchLimit = false;
    try {
      for (let pass = 0; pass < 100; pass += 1) {
        const pageResponse = await fetch("/api/admin/assets/scan", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset: 0, limit: 100, sortBy, direction, userId: filterUser || undefined, onlyOrphans: true })
        });
        const page = await pageResponse.json();
        if (!pageResponse.ok) throw new Error(page.error ?? "无法重新检查图片");
        const ids = (page.candidates as AssetItem[]).map((item) => item.id);
        if (!ids.length) break;
        const response = await fetch("/api/admin/assets/cleanup", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetIds: ids })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "清理图片失败");
        deleted += data.deleted;
        reclaimed += data.reclaimedBytes;
        failed += data.failures.length;
        if (!data.deleted) break;
        if (pass === 99) reachedBatchLimit = true;
      }
      let remaining = 0;
      if (reachedBatchLimit) {
        const remainingResponse = await fetch("/api/admin/assets/scan", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset: 0, limit: 1, sortBy, direction, userId: filterUser || undefined, onlyOrphans: true })
        });
        const page = await remainingResponse.json();
        if (!remainingResponse.ok) throw new Error(page.error ?? "无法确认剩余图片数量");
        remaining = page.totalCandidates as number;
      }
      setNotice(`已清理 ${deleted} 条记录，实际释放 ${formatSize(reclaimed)}。${failed ? ` ${failed} 项未能清理，请检查候选列表。` : ""}${remaining ? ` 尚有 ${remaining} 张安全候选未处理，可再次点击继续。` : ""}`);
      await scan(0, filterUser, sortBy, direction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理图片失败");
    } finally {
      setBusy(false);
    }
  }

  const pageCount = result ? Math.max(1, Math.ceil(result.totalItems / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const summary = result?.summary;

  return <>
    <h1 className="admin-title">图片存储清理</h1>
    <p className="admin-description">引用数按当前页面、历史版本、封面或垃圾箱资源对象计数；垃圾箱内容仍会保护图片。清理会重新检查引用；完整文件先隔离，无引用的缺失文件仅移除数据库记录。</p>
    {error && <p className="form-error" role="alert"><AlertCircle size={15} />{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {!result ? <div className="status-line">正在扫描图片存储...</div> : <>
      <div className="metric-grid storage-metric-grid">
        <Metric title="图片总数" value={summary!.totalImages.toLocaleString("zh-CN")} icon={<HardDrive size={17} />} />
        <Metric title="存储占用" value={formatSize(summary!.totalStorageBytes)} icon={<HardDrive size={17} />} />
        <Metric title="有效引用图片" value={summary!.referencedImages.toLocaleString("zh-CN")} icon={<CheckSquare size={17} />} />
        <Metric title="可清理记录" value={`${summary!.orphanCandidates.toLocaleString("zh-CN")} · ${formatSize(summary!.reclaimableBytes)}`} icon={<Trash2 size={17} />} />
      </div>
      <div className="asset-scan-toolbar">
        <div className="asset-filters">
          <label>用户<select className="control-input" value={filterUser} onChange={(event) => { setFilterUser(event.target.value); void scan(0, event.target.value, sortBy, direction); }}>
            <option value="">全部用户</option>{users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
          </select></label>
          <label>排序<select className="control-input" value={sortBy} onChange={(event) => { const value = event.target.value as typeof sortBy; setSortBy(value); void scan(0, filterUser, value, direction); }}>
            <option value="uploadedAt">上传时间</option><option value="size">文件大小</option><option value="username">所属用户</option>
          </select></label>
          <button className="button-outline" type="button" onClick={() => { const value = direction === "desc" ? "asc" : "desc"; setDirection(value); void scan(0, filterUser, sortBy, value); }}>{direction === "desc" ? "降序" : "升序"}</button>
        </div>
        <div className="asset-actions">
          <button className="button-outline" type="button" disabled={busy} onClick={() => void scan(offset, filterUser, sortBy, direction)}><RefreshCw size={14} />重新扫描</button>
          <button className="button-outline" type="button" disabled={busy || !selectedIds.size} onClick={async () => {
            const bytes = selectedBytes;
            const ids = [...selectedIds];
            if (await confirm(`将重新验证并清理 ${ids.length} 条记录（缺失文件仅移除记录），预计释放 ${formatSize(bytes)}。继续吗？`, "清理选中图片")) await cleanup(ids);
          }}><Trash2 size={14} />清理选中 ({selectedIds.size})</button>
          <button className="button-danger" type="button" disabled={busy || !result.totalCandidates} onClick={() => void cleanupAll()}><Trash2 size={14} />清理全部安全候选</button>
        </div>
      </div>
      {!summary!.scanComplete && <div className="asset-warning" role="alert">有笔记正文或历史版本无法解析。本轮已将未确认图片标记为需检查，并禁止清理。</div>}
      <div className="asset-storage-notes">
        <span>宽限期：{result.graceHours} 小时</span>
        <span>未登记磁盘文件：{summary!.unknownFiles}</span>
        <span>待处理隔离文件：{summary!.pendingQuarantine}</span>
        <span>不确定项不会自动删除</span>
        {summary!.pendingQuarantine > 0 && <button className="button-outline" type="button" disabled={busy} onClick={() => void cleanup([], true)}>处理隔离文件</button>}
      </div>
      <section className="admin-section asset-table-wrap">
        <div className="asset-table-heading">
          <div><h2>图片记录</h2><span>{result.totalItems} 个记录 · 第 {currentPage}/{pageCount} 页</span></div>
          <button className="button-outline" type="button" disabled={!pageOrphans.length} onClick={toggleCurrentCandidates}>{selectedIds.size === pageOrphans.length && pageOrphans.length ? "取消选择" : "选择本页安全候选"}</button>
        </div>
        {!result.candidates.length ? <div className="status-line">没有匹配的图片记录</div> : <div className="asset-table">
          {result.candidates.map((item) => <article className="asset-row" key={item.id}>
            <label className="asset-select">
              <input type="checkbox" checked={selectedIds.has(item.id)} disabled={!isAssetCleanupCandidate(item.status) || busy} onChange={() => toggleSelected(item.id)} aria-label={`选择图片 ${item.id.slice(0, 8)}`} />
            </label>
            {item.status === "file-missing" ? <div className="asset-preview asset-preview-missing" aria-label="文件缺失"><ImageOff size={22} /></div> : <Image className="asset-preview" src={`/uploads/notes/${item.id}`} alt="" width={72} height={54} unoptimized />}
            <div className="asset-details">
              <strong title={item.fileName}>{item.id.slice(0, 8)}</strong>
              <span>{item.username} · {formatSize(item.size)} · {new Date(item.uploadedAt).toLocaleString("zh-CN")}</span>
              <small>{item.reason} · 当前页面 {item.currentPageReferences} · 历史版本 {item.snapshotReferences} · 笔记本封面 {item.notebookCoverReferences} · 垃圾箱资源 {item.trashResourceReferences}（引用对象 {item.referenceCount}）</small>
            </div>
            <span className={`asset-status status-${item.status}`}>{statusLabel(item.status)}</span>
          </article>)}
        </div>}
        <div className="asset-pagination">
          <button className="button-outline" type="button" disabled={busy || offset === 0} onClick={() => void scan(Math.max(0, offset - PAGE_SIZE), filterUser, sortBy, direction)}>上一页</button>
          <span>第 {currentPage} / {pageCount} 页</span>
          <button className="button-outline" type="button" disabled={busy || offset + PAGE_SIZE >= result.totalItems} onClick={() => void scan(offset + PAGE_SIZE, filterUser, sortBy, direction)}>下一页</button>
        </div>
      </section>
      {summary!.unknownFiles > 0 && <section className="admin-section untracked-files-section">
        <h2>未登记的磁盘文件 ({summary!.unknownFiles})</h2>
        <p className="status-line">这些文件没有对应的图片记录，可能是旧版本或异常文件。系统不会自动删除它们。</p>
        {result.untrackedFiles.map((file) => <div className="untracked-file-row" key={file.name}>
          <code>{file.name}</code><span>{file.type === "symlink" ? "符号链接，禁止自动处理" : formatSize(file.size)}</span><span>{new Date(file.modifiedAt).toLocaleString("zh-CN")}</span>
        </div>)}
        {summary!.unknownFiles > result.untrackedFiles.length && <p className="status-line">仅显示前 {result.untrackedFiles.length} 个文件。</p>}
      </section>}
    </>}
    {busy && <div className="asset-busy-indicator" role="status"><ScanSearch size={15} />正在处理图片存储...</div>}
  </>;
}

function Metric({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return <div className="metric-card"><span>{icon}{title}</span><strong>{value}</strong></div>;
}

function statusLabel(status: AssetStatus) {
  return status === "orphan" ? "可清理候选" : status === "grace-period" ? "宽限期内" :
    status === "referenced" ? "仍被引用" : status === "file-missing" ? "文件缺失" : "需检查";
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
