"use client";

import { useEffect, useState } from "react";
import { Download, Upload, KeyRound, Pencil, Users, Trash2 } from "lucide-react";
import { useKnowledgeImportConflicts } from "@/components/knowledge-import-conflicts";
import { useConfirm } from "@/components/ui/alert-dialog";

type AdminUser = { id: string; username: string; createdAt: string; notebookCount: number; pageCount: number; entryCount: number; imageCount: number; storageBytes: number };
export default function AdminUsersPage() {
  const confirm = useConfirm();
  const { chooseConflictPolicy, conflictDialog } = useKnowledgeImportConflicts();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/users").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法读取用户");
      setUsers(result.users);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法读取用户"));
  }, []);
  async function updateUsername(user: AdminUser) {
    const nextUsername = window.prompt(`为「${user.username}」设置新用户名`, user.username)?.trim();
    if (!nextUsername) return;
    if (nextUsername.length < 3 || nextUsername.length > 32 || !/^[\p{L}\p{N}_.-]+$/u.test(nextUsername)) {
      setError("用户名仅支持 3-32 个字符，允许字母、数字、下划线、点和减号");
      return;
    }
    setPending(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nextUsername })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法修改用户名");
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, username: result.user.username } : item));
      setSuccess(`用户名已更新为 ${result.user.username}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法修改用户名"); }
    finally { setPending(null); }
  }

  async function deleteUser(user: AdminUser) {
    if (pending || !await confirm(`永久删除用户「${user.username}」及其全部笔记本、页面、历史版本、设置、登录会话和图片？此操作无法撤销，请先导出需要保留的数据。`, "永久删除用户")) return;
    setPending(user.id);
    setError(""); setSuccess(""); setTemporaryPassword("");
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法删除用户");
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setSuccess(`用户「${user.username}」已删除。${result.pendingFiles ? ` ${result.pendingFiles} 个附件保留在隔离目录，可在存储清理中重试。` : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除用户"); }
    finally { setPending(null); }
  }

  async function resetPassword(user: AdminUser) {
    if (!await confirm(`为「${user.username}」生成临时密码？对方现有会话将失效。`, "重置密码")) return;
    setPending(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法重置密码");
      setTemporaryPassword(`${user.username}: ${result.temporaryPassword}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法重置密码"); }
    finally { setPending(null); }
  }
  async function exportData(user: AdminUser) {
    setPending(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/export`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `user-backup-${user.username}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败"); }
    finally { setPending(null); }
  }
  async function restoreData(user: AdminUser, file: File) {
    if (!await confirm(`将备份中的文件夹、笔记本、页面、图片和历史版本恢复为「${user.username}」的新笔记本，不覆盖现有数据。继续？`, "恢复备份")) return;
    setPending(user.id);
    setError("");
    setSuccess("");
    try {
      const form = new FormData();
      form.append("userId", user.id);
      form.append("file", file);
      let response = await fetch("/api/admin/restore/user", { method: "POST", body: form });
      let result = await response.json();
      if (response.status === 409) {
        const policy = await chooseConflictPolicy(result);
        if (!policy) return;
        form.set("conflictPolicy", policy);
        response = await fetch("/api/admin/restore/user", { method: "POST", body: form });
        result = await response.json();
      }
      if (!response.ok) throw new Error(result.error ?? "恢复失败");
      setSuccess(`恢复完成：${result.restored.notebooks} 个笔记本、${result.restored.pages} 个页面，新增 ${result.restored.entries ?? 0} 个词条、复用 ${result.restored.reusedEntries ?? 0} 个、重命名 ${result.restored.renamedEntries ?? 0} 个。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "恢复失败"); }
    finally { setPending(null); }
  }
  return <>
    {conflictDialog}
    <h1 className="admin-title">用户管理</h1><p className="admin-description">查看用户数据使用情况、重置密码或导出用户数据</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="form-success" role="status">{success}</p>}
    {temporaryPassword && <div className="admin-section" style={{ marginBottom: 15 }}>
      <strong>临时密码（仅展示一次）</strong>
      <p style={{ userSelect: "all", fontFamily: "monospace" }}>{temporaryPassword}</p>
      <div className="admin-button-group">
      <button className="button-outline" onClick={() => { void navigator.clipboard.writeText(temporaryPassword).catch(() => setError("无法访问剪贴板，请手动复制临时密码")); }}>复制临时密码</button>
      <button className="button-subtle" onClick={() => setTemporaryPassword("")}>关闭</button>
      </div>
    </div>}
    <section className="admin-section admin-users-section">
      <h2><Users size={14} />注册用户</h2>
      {!users.length ? <div className="status-line">暂无普通用户</div> : users.map((user) => <div className="admin-user-row" key={user.id}>
        <div className="admin-user-main"><strong>{user.username}</strong><span>注册于 {new Date(user.createdAt).toLocaleDateString("zh-CN")}</span></div>
        <dl className="admin-user-metrics" aria-label={`${user.username} 使用统计`}>
          <div><dt>笔记本</dt><dd>{user.notebookCount.toLocaleString("zh-CN")}</dd></div>
          <div><dt>页面</dt><dd>{user.pageCount.toLocaleString("zh-CN")}</dd></div>
          <div><dt>词条</dt><dd>{user.entryCount.toLocaleString("zh-CN")}</dd></div>
          <div><dt>图片</dt><dd>{user.imageCount.toLocaleString("zh-CN")}</dd></div>
          <div><dt>存储用量</dt><dd>{formatSize(user.storageBytes)}</dd></div>
        </dl>
        <div className="admin-user-actions">
        <button className="button-outline" disabled={pending !== null} onClick={() => void updateUsername(user)}><Pencil size={14} />修改用户名</button>
        <button className="button-outline" disabled={pending !== null} onClick={() => void resetPassword(user)}><KeyRound size={14} />重置密码</button>
        <button className="button-outline" disabled={pending !== null} onClick={() => void exportData(user)}><Download size={14} />导出全部</button>
        <label className="button-outline" aria-disabled={pending !== null}><Upload size={14} />恢复备份<input type="file" accept=".zip,application/zip" hidden disabled={pending !== null} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void restoreData(user, file);
          event.target.value = "";
        }} /></label>
        <button className="button-danger" disabled={pending !== null} onClick={() => void deleteUser(user)}><Trash2 size={14} />删除用户</button>
        </div>
      </div>)}
    </section>
  </>;
}
function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
