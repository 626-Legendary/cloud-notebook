"use client";

import { useState } from "react";

export function AdminRegistrationSwitch({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleToggle() {
    const next = !enabled;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationEnabled: next })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法更新注册状态");
      setEnabled(Boolean(result.registrationEnabled ?? next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法更新注册状态");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 42 }}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="允许新用户注册"
        disabled={pending}
        onClick={() => void handleToggle()}
        style={{
          position: "relative",
          width: 46,
          height: 28,
          borderRadius: 999,
          border: "1px solid rgba(0,0,0,0.15)",
          background: enabled ? "#3A3E5A" : "#dfe3ee",
          cursor: pending ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          padding: 0
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: enabled ? 22 : 3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
            transition: "all 0.2s ease"
          }}
        />
      </button>
      <span>{enabled ? "已开启" : "已关闭"}</span>
      {error && <span role="alert" style={{ color: "var(--destructive, #b42318)" }}>{error}</span>}
    </div>
  );
}
