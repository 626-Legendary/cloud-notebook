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
      <div className="brand-row"><span className="brand-small"><Image src="/icon.png" alt="" width={24} height={24} unoptimized /></span>管理控制台</div>
      <AdminNavigation />
    </aside>
    <main className="admin-main"><AdminHeader />{children}</main>
  </div>;
}
