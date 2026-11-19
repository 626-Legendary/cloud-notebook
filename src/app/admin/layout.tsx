import Image from "next/image";
import { AdminNavigation } from "@/components/admin-navigation";
import { redirect } from "next/navigation";
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
      <div className="brand-row"><span className="brand-small"><Image src="/icon.png" alt="" width={24} height={24} unoptimized /></span><span className="admin-sidebar-brand"><strong>Cloud Notebook</strong><span>管理控制台</span></span></div>
      <nav className="admin-nav-links" aria-label="管理导航"><AdminNavigation /></nav>
      <AdminHeader />
    </aside>
    <main className="admin-main">{children}</main>
  </div>;
}
