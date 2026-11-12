/** UI preferences only. Document font sizes belong to editor-font-size.ts. */
export const uiFontSizeOptions = [
  { value: "compact", label: "紧凑" },
  { value: "standard", label: "标准" },
  { value: "large", label: "大号" }
] as const;

export type UiFontSize = typeof uiFontSizeOptions[number]["value"];
export const uiFontSizeCookie = "cloud-notebook-ui-font-size";

export function isUiFontSize(value: unknown): value is UiFontSize {
  return uiFontSizeOptions.some((option) => option.value === value);
}

export function normalizeUiFontSize(value: unknown): UiFontSize {
  return isUiFontSize(value) ? value : "standard";
}
