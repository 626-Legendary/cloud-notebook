import { describe, expect, it } from "vitest";
import { createSearchSnippet, extractSearchableText } from "@/lib/search-text";

describe("search text extraction", () => {
  it("extracts Chinese paragraph, heading, list, and table cell content without marks", () => {
    const content = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "数据库", marks: [{ type: "bold" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "索引" }, { type: "text", text: "性能" }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "中文检索" }] }] }] }] }
      ]
    });
    expect(extractSearchableText(content)).toContain("数据库");
    expect(extractSearchableText(content)).toContain("索引性能");
    expect(extractSearchableText(content)).toContain("中文检索");
  });

  it("returns a contextual snippet for Chinese substring matches", () => {
    expect(createSearchSnippet("前文内容 搜索目标 后文内容", "搜索目标")).toContain("搜索目标");
    expect(extractSearchableText("{invalid")).toBe("");
  });
});
