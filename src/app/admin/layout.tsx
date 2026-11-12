import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, Archive, HardDrive, Settings2, Users } from "lucide-react";
import { AdminHeader } from "@/components/admin-actions";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/app");
  if (session.mustChangePassword) redirect("/change-password");
  return <div className="admin-shell">
    <aside className="admin-nav">
      <div className="brand-row"><span className="brand-small">C</span>管理控制台</div>
      <Link href="/admin"><Activity size={15} />系统概览</Link>
      <Link href="/admin/users"><Users size={15} />用户管理</Link>
      <Link href="/admin/assets"><HardDrive size={15} />存储清理</Link>
      <Link href="/admin/backups"><Archive size={15} />数据备份</Link>
      <Link href="/admin/settings"><Settings2 size={15} />系统设置</Link>
    </aside>
    <main className="admin-main"><AdminHeader />{children}</main>
  </div>;
}
