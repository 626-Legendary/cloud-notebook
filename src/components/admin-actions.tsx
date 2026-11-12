"use client";

import { useLogout, LogoutProgress } from "@/components/use-logout";
import { Cloud, LogOut } from "lucide-react";

export function AdminHeader() {
  const { logout, pending } = useLogout();
  return <div className="admin-topbar">
    <LogoutProgress pending={pending} />
    <span className="brand-row" style={{ marginRight: "auto", padding: 0 }}><span className="brand-small"><Cloud size={15} /></span>Cloud Notebook · 管理</span>
    <button className="button-outline" disabled={pending} onClick={() => void logout()}><LogOut size={13} />退出登录</button>
  </div>;
}
