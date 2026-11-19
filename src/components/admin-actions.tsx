"use client";

import { useLogout, LogoutProgress } from "@/components/use-logout";
import { LogOut } from "lucide-react";

export function AdminHeader() {
  const { logout, pending } = useLogout();
  return <div className="admin-topbar">
    <LogoutProgress pending={pending} />
    <button className="button-outline" disabled={pending} onClick={() => void logout()}><LogOut size={13} />退出登录</button>
  </div>;
}
