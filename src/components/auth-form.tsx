"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { LoaderCircle } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { notify } from "@/lib/notifications";

const subscribeHydration = () => () => {};

export function AuthForm({ mode, registrationEnabled = true, isTest = false }: { mode: "login" | "register"; registrationEnabled?: boolean; isTest?: boolean }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const selectedTheme = hydrated && (theme === "light" || theme === "dark") ? theme : "system";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const register = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, ...(register ? { confirmPassword } : {}) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "操作失败，请重试");
      router.replace(result.redirectTo ?? (result.user.role === "ADMIN" ? "/admin" : "/app"));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络连接失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-theme"><ThemeToggle value={selectedTheme} onChange={setTheme} /></div>
      <section className="auth-card">
        <div className="brand-mark"><Image src="/icon.png" alt="" width={48} height={48} unoptimized /></div>
        <div className="auth-brand">Cloud Notebook{isTest && <span className="environment-badge environment-test">测试版</span>}</div>
        <p className="auth-subtitle">{register ? "开辟一个只属于你的笔记空间" : "欢迎回来，继续记录你的想法"}</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="field-label" htmlFor="username">用户名</label>
          <Input id="username" autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入用户名" />
          <label className="field-label" htmlFor="password">密码</label>
          <PasswordInput id="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 10 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={register ? "至少 10 位" : "输入密码"} />
          {register && <>
            <label className="field-label" htmlFor="confirm-password">确认密码</label>
            <PasswordInput id="confirm-password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" />
          </>}
          <div className="auth-error-slot" tabIndex={error ? 0 : -1} aria-live="polite" aria-atomic="true"><p className="form-error">{error || "\u00a0"}</p></div>
          <Button className="auth-submit" disabled={pending}>
            {pending ? <LoaderCircle size={16} className="spin" /> : null}
            {pending ? "请稍候..." : register ? "创建账号" : "登录"}
          </Button>
        </form>
        <div className="auth-footer">
          {register ? "已有账号？" : "还没有账号？"}
          {registrationEnabled ? (
            <Link href={register ? "/login" : "/register"}>{register ? "返回登录" : "创建账号"}</Link>
          ) : (
            <button type="button" onClick={() => notify.info("请联系管理员开放注册入口")} style={{ background: "transparent", border: "none", color: "var(--ui-text-link)", cursor: "pointer", padding: 0 }}>
              {register ? "返回登录" : "创建账号"}
            </button>
          )}
        </div>
        <div className="privacy-note">轻如云，稳如磐</div>
      </section>
    </main>
  );
}
