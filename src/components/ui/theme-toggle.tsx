"use client";

import { Monitor, Moon, Sun } from "lucide-react";

const themes = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor }
] as const;

export function ThemeToggle({ value, onChange }: {
  value: "system" | "light" | "dark";
  onChange: (value: "system" | "light" | "dark") => void;
}) {
  return <div className="theme-toggle" role="group" aria-label="主题">
    {themes.map(({ value: theme, label, Icon }) => <button
      key={theme}
      type="button"
      className={`theme-toggle-button ${value === theme ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={value === theme}
      onClick={() => onChange(theme)}
    ><Icon size={15} /></button>)}
  </div>;
}
