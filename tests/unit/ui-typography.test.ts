import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUiFontSize, normalizeUiFontSize } from "@/lib/ui-typography";

const css = readFileSync("src/app/typography.css", "utf8");

describe("UI typography boundaries", () => {
  it("defaults invalid preferences and accepts only supported presets", () => {
    for (const value of [undefined, "", "huge", "14px", {}, null]) {
      expect(isUiFontSize(value)).toBe(false);
      expect(normalizeUiFontSize(value)).toBe("standard");
    }
    for (const value of ["compact", "standard", "large"]) expect(normalizeUiFontSize(value)).toBe(value);
  });

  it("keeps even, readable sizes and a nondecreasing hierarchy in every preset", () => {
    for (const preset of ["compact", "standard", "large"]) {
      const rule = css.match(new RegExp(`:root\\[data-ui-font-size="${preset}"\\]\\s*\\{([^}]+)\\}`))![1];
      const sizes = [...rule.matchAll(/--ui-[a-z]+:\s*(\d+)px/g)].map((match) => Number(match[1]));
      expect(sizes).toHaveLength(5);
      expect(sizes.every((value) => value >= 12 && value % 2 === 0)).toBe(true);
      expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
      if (preset === "standard") expect(sizes).toEqual([12, 14, 16, 20, 24]);
    }
  });

  it("allows fixed sizes only in document and print selectors, not UI CSS", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    for (const rule of globals.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/font-size:\s*(?:[\d.]|clamp\()/g.test(rule[2])) continue;
      const selector = rule[1].trim();
      expect(selector.includes(".notebook-editor") || selector.includes(".prose-print") || selector === ".title-input", selector).toBe(true);
    }
    expect(globals).not.toMatch(/font-size:\s*var\(--ui-[a-z]+\)[^}]*\.notebook-editor/);
  });
});
