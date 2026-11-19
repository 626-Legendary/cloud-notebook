"use client";

import { useLogout, LogoutProgress } from "@/components/use-logout";
import Image from "next/image";
import { LogOut } from "lucide-react";

export function AdminHeader() {
  const { logout, pending } = useLogout();
  return <div className="admin-topbar">
    <LogoutProgress pending={pending} />
    <span className="admin-brand"><Image src="/icon.png" alt="" width={24} height={24} unoptimized /><span><strong>Cloud Notebook</strong><span>管理控制台</span></span></span>
    <button className="button-outline" disabled={pending} onClick={() => void logout()}><LogOut size={13} />退出登录</button>
  </div>;
}
