import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { findTextRanges } from "@/lib/prosemirror-search";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { group: "inline" }
  },
  marks: { strong: {} }
});

describe("findTextRanges", () => {
  it("matches Chinese text across marked text nodes in one paragraph", () => {
    const document = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("跨", [schema.mark("strong")]),
        schema.text("节点搜索")
      ])
    ]);
    expect(findTextRanges(document, "跨节点")).toEqual([{ from: 1, to: 4 }]);
  });

  it("does not match across paragraph boundaries", () => {
    const document = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("跨")),
      schema.node("paragraph", null, schema.text("段落"))
    ]);
    expect(findTextRanges(document, "跨段")).toEqual([]);
  });
});
