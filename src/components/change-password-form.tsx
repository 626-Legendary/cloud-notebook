"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Cloud } from "lucide-react";
import { PasswordInput } from "@/components/password-input";

export function ChangePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法修改密码");
      router.replace("/login");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络连接失败");
    } finally { setPending(false); }
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="brand-mark"><Cloud size={19} /></div><div className="auth-brand">更新密码</div>
    <p className="auth-subtitle">首次登录或密码重置后，请设置一个新的安全密码</p>
    <form className="auth-form" onSubmit={submit}>
      <label className="field-label" htmlFor="new-password">新密码</label>
      <PasswordInput id="new-password" minLength={10} maxLength={128} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      <label className="field-label" htmlFor="new-password-confirm">确认新密码</label>
      <PasswordInput id="new-password-confirm" maxLength={128} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary auth-submit" disabled={pending}>{pending ? "正在保存..." : "更新密码"}</button>
    </form>
  </section></main>;
}
