"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Download, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/alert-dialog";

type Backup = { id: string; filename: string; size: number; checksum: string; status: string; createdAt: string };
export default function AdminBackupsPage() {
  const confirm = useConfirm();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/backups");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "无法读取备份列表");
    setBackups(result.backups);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法读取备份")); }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  async function create() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/admin/backups", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "创建备份失败");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建备份失败"); }
    finally { setPending(false); }
  }
  async function remove(backup: Backup) {
    if (!await confirm(`永久删除备份「${backup.filename}」？此操作不可撤销。`, "删除备份")) return;
    try {
      const response = await fetch(`/api/admin/backups/${backup.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法删除备份");
      setBackups((current) => current.filter((item) => item.id !== backup.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除备份"); }
  }
  return <>
    <h1 className="admin-title">数据备份</h1>
    <p className="admin-description">完整备份包括 SQLite 数据库与图片附件；备份存放于服务器本地，请定期下载到其他设备。</p>
    <div style={{ marginBottom: 16 }}><button className="button-primary" disabled={pending} onClick={() => void create()}><Plus size={14} />{pending ? "正在创建..." : "立即创建备份"}</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="admin-section">
      <h2>备份记录</h2>
      {!backups.length ? <div className="status-line">尚无备份</div> : backups.map((backup) => <div className="backup-row" key={backup.id}>
        <Archive size={15} />
        <div style={{ flex: 1, minWidth: 140 }}><strong className="block text-ui-secondary">{backup.filename}</strong><span className="status-line">{new Date(backup.createdAt).toLocaleString("zh-CN")} · {formatSize(backup.size)}</span><code className="backup-checksum">SHA-256 {backup.checksum}</code></div>
        <a className="icon-button" title="下载备份" href={`/api/admin/backups/${backup.id}`} download={backup.filename}><Download size={14} /></a>
        <button className="icon-button" title="删除备份" onClick={() => void remove(backup)}><Trash2 size={14} /></button>
      </div>)}
    </section>
    <p className="status-line" style={{ marginTop: 15 }}>自动备份默认每日执行，保留策略由服务器环境变量配置。仅存放在同一块物理硬盘的备份无法防止硬盘故障。</p>
  </>;
}
function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
