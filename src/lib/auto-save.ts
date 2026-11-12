export const autoSaveOptions = [
  { value: "realtime", label: "实时保存" },
  { value: "60s", label: "每 1 分钟" },
  { value: "300s", label: "每 5 分钟" },
  { value: "600s", label: "每 10 分钟" },
  { value: "off", label: "关闭" }
] as const;

export function normalizeAutoSaveMode(mode: string) {
  return autoSaveOptions.some((option) => option.value === mode) ? mode : "realtime";
}

export function autoSaveDelay(mode: string): number | null {
  const normalized = normalizeAutoSaveMode(mode);
  if (normalized === "off") return null;
  return normalized === "realtime" ? 10_000 : Number.parseInt(normalized, 10) * 1000;
}
