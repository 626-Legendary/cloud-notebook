"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Archive, HardDrive, Settings2, Users } from "lucide-react";

const links = [
  { href: "/admin", label: "系统概览", icon: Activity },
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/assets", label: "存储清理", icon: HardDrive },
  { href: "/admin/backups", label: "数据备份", icon: Archive },
  { href: "/admin/settings", label: "系统设置", icon: Settings2 }
];
export function AdminNavigation() {
  const pathname = usePathname();
  return links.map((link) => <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : undefined} aria-current={pathname === link.href ? "page" : undefined}><link.icon size={16} />{link.label}</Link>);
}
