import { describe, expect, it, vi } from "vitest";
import { contentToMarkdown } from "@/lib/markdown";
import { formatRelative } from "@/lib/time";

describe("content export", () => {
  it("converts common Tiptap nodes to Markdown", () => {
    const content = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "摘要" }] },
        { type: "paragraph", content: [{ type: "text", text: "重要", marks: [{ type: "bold" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "条目" }] }] }] }
      ]
    });
    expect(contentToMarkdown(content)).toContain("## 摘要");
    expect(contentToMarkdown(content)).toContain("**重要**");
    expect(contentToMarkdown(content)).toContain("- 条目");
  });

  it("returns an empty Markdown document for invalid JSON", () => {
    expect(contentToMarkdown("{")).toBe("");
  });
});

describe("relative time", () => {
  it("formats timestamps from real time differences", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    expect(formatRelative("2026-10-22T11:58:00.000Z")).toBe("2 分钟前");
    expect(formatRelative("not-a-date")).toBe("");
    vi.useRealTimers();
  });
});
