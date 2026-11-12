// Stable persisted CSS variables shared by editor and print routes.
export const fontFamilies = [
  { id: "default", label: "默认字体", value: "", type: "default" },
  { id: "noto-sans-sc", label: "思源黑体", value: "var(--font-noto-sans-sc), sans-serif", type: "zh" },
  { id: "noto-serif-sc", label: "思源宋体", value: "var(--font-noto-serif-sc), serif", type: "zh" },
  { id: "zcool-xiaowei", label: "站酷小薇体", value: "var(--font-zcool-xiaowei), serif", type: "zh" },
  { id: "zcool-qingke-huangyou", label: "站酷庆科黄油体", value: "var(--font-zcool-qingke-huangyou), sans-serif", type: "zh" },
  { id: "ma-shan-zheng", label: "马善政毛笔字体", value: "var(--font-ma-shan-zheng), cursive", type: "zh" },
  { id: "inter", label: "Inter", value: "var(--font-inter), sans-serif", type: "en" },
  { id: "roboto", label: "Roboto", value: "var(--font-roboto), sans-serif", type: "en" },
  { id: "open-sans", label: "Open Sans", value: "var(--font-open-sans), sans-serif", type: "en" },
  { id: "merriweather", label: "Merriweather", value: "var(--font-merriweather), serif", type: "en" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", value: "var(--font-ibm-plex-mono), monospace", type: "en" },
  { id: "jf-open-huninn", label: "粉圆体", value: "var(--font-jf-open-huninn), sans-serif", type: "zh" },
  { id: "zhi-mang-xing", label: "织芒行书", value: "var(--font-zhi-mang-xing), cursive", type: "zh" },
  { id: "long-cang", label: "龙苍草书／行草", value: "var(--font-long-cang), cursive", type: "zh" },
  { id: "montserrat", label: "Montserrat", value: "var(--font-montserrat), sans-serif", type: "en" },
  { id: "poppins", label: "Poppins", value: "var(--font-poppins), sans-serif", type: "en" },
  { id: "plus-jakarta-sans", label: "Plus Jakarta Sans", value: "var(--font-plus-jakarta-sans), sans-serif", type: "en" },
  { id: "lora", label: "Lora", value: "var(--font-lora), serif", type: "en" },
  { id: "cinzel", label: "Cinzel", value: "var(--font-cinzel), serif", type: "en" },
  { id: "caveat", label: "Caveat", value: "var(--font-caveat), cursive", type: "en" },
] as const;

const legacyFonts = [
  { label: "默认字体", value: "" },
  { label: "Inter", value: 'Inter, "Noto Sans SC", sans-serif' },
  { label: "Roboto", value: 'Roboto, "Noto Sans SC", sans-serif' },
  { label: "Open Sans", value: '"Open Sans", "Noto Sans SC", sans-serif' },
  { label: "Lato", value: 'Lato, "Noto Sans SC", sans-serif' },
  { label: "Montserrat", value: 'Montserrat, "Noto Sans SC", sans-serif' },
  { label: "Source Sans 3", value: '"Source Sans 3", "Noto Sans SC", sans-serif' },
  { label: "Merriweather", value: 'Merriweather, "Noto Serif SC", serif' },
  { label: "Playfair Display", value: '"Playfair Display", "Noto Serif SC", serif' },
  { label: "Noto Sans SC", value: '"Noto Sans SC", sans-serif' },
  { label: "Noto Serif SC", value: '"Noto Serif SC", serif' },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", "Noto Sans SC", monospace' }
] as const;

const allowedFamilies = new Set<string>([
  ...fontFamilies.map((font) => font.value).filter(Boolean),
  ...legacyFonts.map((font) => font.value).filter((value) => value !== ""),
  "ui-sans-serif", "ui-monospace", "Georgia,serif", "Arial", "serif", "sans-serif", "monospace"
]);

export function isSafeFontFamily(value: unknown): value is string {
  return typeof value === "string" && allowedFamilies.has(value);
}

// Resolve old display-name stacks without rewriting saved notes or snapshots.
export function resolveFontFamily(value: string): string {
  const legacy = legacyFonts.find((font) => font.value === value);
  if (!legacy) return value;
  const aliases: Record<string, string> = { "Noto Sans SC": "noto-sans-sc", "Noto Serif SC": "noto-serif-sc", "Open Sans": "open-sans", "IBM Plex Mono": "ibm-plex-mono" };
  return fontFamilies.find((font) => font.id === (aliases[legacy.label] ?? legacy.label.toLowerCase()))?.value ?? value;
}
