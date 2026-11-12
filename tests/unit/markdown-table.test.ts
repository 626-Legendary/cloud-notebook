import { describe, expect, it } from "vitest";
import { parseMarkdownTable } from "@/lib/markdown-table";

describe("parseMarkdownTable", () => {
  it("parses valid header, separator, and data rows", () => {
    expect(parseMarkdownTable("| Name | Score |\n| --- | --- |\n| Alice | 90 |")).toEqual([
      ["Name", "Score"],
      ["Alice", "90"]
    ]);
  });

  it("preserves escaped pipes and blank cells", () => {
    expect(parseMarkdownTable("| A\\|B | Empty |\n| --- | --- |\n| one\\|two | |")).toEqual([
      ["A|B", "Empty"],
      ["one|two", ""]
    ]);
  });

  it("leaves non-table pipe text alone", () => {
    expect(parseMarkdownTable("a | b | c")).toBeNull();
    expect(parseMarkdownTable("| a | b |\n| --- |")).toBeNull();
  });
});
