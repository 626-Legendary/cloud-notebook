"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, BookOpen, FileText, HardDrive, Users, BookOpenText, Image as ImageIcon } from "lucide-react";

type Overview = { users: number; notebooks: number; pages: number; entries: number; images: number; storageBytes: number; latestBackup: { filename: string; createdAt: string } | null };
export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/admin/overview").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法加载概览");
      setData(result);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法加载概览"));
  }, []);
  const items = [
    { title: "普通用户", value: data?.users ?? "—", icon: Users },
    { title: "笔记本", value: data?.notebooks ?? "—", icon: BookOpen },
    { title: "笔记页面", value: data?.pages ?? "—", icon: FileText },
    { title: "知识库词条", value: data?.entries ?? "—", icon: BookOpenText },
    { title: "图片数量", value: data?.images ?? "—", icon: ImageIcon },
    { title: "图片占用", value: data ? formatSize(data.storageBytes) : "—", icon: HardDrive }
  ];
  return <>
    <h1 className="admin-title">系统概览</h1>
    <p className="admin-description">Cloud Notebook 运行状态与数据概况</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="metric-grid admin-overview-metrics">{items.map((item) => <section className="metric-card" key={item.title}>
      <span style={{ display: "flex", alignItems: "center", gap: 7 }}><item.icon size={14} />{item.title}</span><strong>{item.value}</strong>
    </section>)}</div>
    <section className="admin-section admin-knowledge-summary"><h2><BookOpenText size={18} />知识库管理</h2><p>查看用户的词条数量、名称、别名和回收站状态。</p><Link className="button-outline" href="/admin/knowledge">查看知识库词条</Link></section>
    <section className="admin-section">
      <h2>最近一次备份</h2>
      {data?.latestBackup ? <div className="backup-row"><Archive size={15} /><span style={{ flex: 1 }}>{data.latestBackup.filename}</span><span className="status-line">{new Date(data.latestBackup.createdAt).toLocaleString("zh-CN")}</span></div> :
        <div className="status-line">尚无备份。建议立即创建第一份系统备份。</div>}
    </section>
  </>;
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
