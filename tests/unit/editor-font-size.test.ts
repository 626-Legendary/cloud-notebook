import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  createFontSizeAdjustment,
  fontSizeSteps,
  nextFontSize,
  parseFontSize,
  selectedFontSizeRange
} from "@/lib/editor-font-size";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: { group: "block", content: "text*", attrs: { level: { default: 1 } } },
    text: { group: "inline" }
  },
  marks: {
    textStyle: { attrs: { fontSize: { default: null }, color: { default: null } } },
    bold: {}
  }
});

function makeState() {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "abc", marks: [{ type: "textStyle", attrs: { fontSize: "16px", color: "#2563EB" } }] },
        { type: "text", text: "de", marks: [{ type: "textStyle", attrs: { fontSize: "20px" } }, { type: "bold" }] },
        { type: "text", text: "fgh" }
      ]
    }]
  });
  return EditorState.create({ schema, doc });
}

describe("font size adjustment", () => {
  it("uses the expected bounded scale and parses only valid integer pixel sizes", () => {
    expect(fontSizeSteps[0]).toBe(8);
    expect(fontSizeSteps.at(-1)).toBe(96);
    expect(nextFontSize(16, 1)).toBe(18);
    expect(nextFontSize(18, -1)).toBe(16);
    expect(nextFontSize(17, 1)).toBe(18);
    expect(nextFontSize(17, -1)).toBe(16);
    expect(nextFontSize(96, 1)).toBeNull();
    expect(nextFontSize(8, -1)).toBeNull();
    expect(parseFontSize("120px")).toBeNull();
    expect(parseFontSize("18px")).toBe(18);
  });

  it("adjusts mixed font sizes independently while retaining other text styles", () => {
    const initial = makeState();
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 1, 9)));
    const transaction = createFontSizeAdjustment(state, 1);
    expect(transaction).not.toBeNull();
    const result = state.apply(transaction!);
    const textNodes: { text: string; fontSize: string | null; color: string | null; bold: boolean }[] = [];
    result.doc.descendants((node) => {
      if (!node.isText) return;
      const style = schema.marks.textStyle.isInSet(node.marks);
      textNodes.push({
        text: node.text ?? "",
        fontSize: style?.attrs.fontSize ?? null,
        color: style?.attrs.color ?? null,
        bold: Boolean(schema.marks.bold.isInSet(node.marks))
      });
    });

    expect(textNodes).toEqual([
      { text: "abc", fontSize: "18px", color: "#2563EB", bold: false },
      { text: "de", fontSize: "22px", color: null, bold: true },
      { text: "fgh", fontSize: "18px", color: null, bold: false }
    ]);
  });

  it("adjusts only the selected portion of a text node", () => {
    const initial = makeState();
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 2, 5)));
    const transaction = createFontSizeAdjustment(state, 1);
    const result = state.apply(transaction!);
    const pieces: { text: string; fontSize: string | null }[] = [];
    result.doc.descendants((node) => {
      if (!node.isText) return;
      pieces.push({
        text: node.text ?? "",
        fontSize: schema.marks.textStyle.isInSet(node.marks)?.attrs.fontSize ?? null
      });
    });

    expect(pieces).toEqual([
      { text: "a", fontSize: "16px" },
      { text: "bc", fontSize: "18px" },
      { text: "d", fontSize: "22px" },
      { text: "e", fontSize: "20px" },
      { text: "fgh", fontSize: null }
    ]);
  });

  it("sets the next input size at a cursor and reports mixed range bounds", () => {
    const initial = makeState();
    const cursorState = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 2)));
    const transaction = createFontSizeAdjustment(cursorState, 1);
    expect(transaction?.storedMarks?.find((mark) => mark.type === schema.marks.textStyle)?.attrs)
      .toMatchObject({ fontSize: "18px", color: "#2563EB" });

    const selected = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 1, 9)));
    expect(selectedFontSizeRange(selected)).toEqual({ minimum: 16, maximum: 20 });
  });
  it("adjusts default heading sizes from their visible scale instead of body size", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "Body" }] }
    ] });
    const initial = EditorState.create({ schema, doc });
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)));
    expect(selectedFontSizeRange(state)).toEqual({ minimum: 16, maximum: 30 });
    const next = state.apply(createFontSizeAdjustment(state, 1)!);
    expect(next.doc.firstChild?.firstChild?.marks[0].attrs.fontSize).toBe("32px");
    expect(next.doc.lastChild?.firstChild?.marks[0].attrs.fontSize).toBe("18px");
    expect(next.selection.from).toBe(state.selection.from);
    expect(next.selection.to).toBe(state.selection.to);
  });

});
