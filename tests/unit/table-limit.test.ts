import { Editor, getSchema } from "@tiptap/core";
import { EditorState, TextSelection, Plugin } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import { documentExtensions } from "@/lib/editor-extensions";
import { selectedTableWidth, tableTransactionWithinLimit } from "@/lib/table-limit";

const cell = (colspan = 1) => ({ type: "tableCell", attrs: { colspan, rowspan: 1 }, content: [{ type: "paragraph" }] });
const table = (columns: number, merged = false) => ({ type: "table", content: [{ type: "tableRow", content: merged ? [cell(2), ...Array.from({ length: columns - 2 }, () => cell())] : Array.from({ length: columns }, () => cell()) }] });
const schema = getSchema(documentExtensions());
describe("logical table column limit", () => {
  it.each([false, true])("counts merged cells correctly (%s), blocks commands at 20 and permits deletion", (merged) => {
    const editor = new Editor({ element: null, extensions: documentExtensions(), content: { type: "doc", content: [table(19, merged)] } });
    // Install state without a DOM view, retaining all editor transaction filters.
    const state = EditorState.create({ schema: editor.schema, doc: editor.schema.nodeFromJSON({ type: "doc", content: [table(19, merged)] }), plugins: [new Plugin({ filterTransaction: tableTransactionWithinLimit })] });
    editor.view.updateState(state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(3)))));
    expect(selectedTableWidth(editor.state)).toBe(19);
    expect(editor.commands.addColumnAfter()).toBe(true);
    expect(TableMap.get(editor.state.doc.firstChild!).width).toBe(20);
    expect(editor.can().addColumnBefore()).toBe(false);
    expect(editor.can().addColumnAfter()).toBe(false);
    expect(editor.commands.addColumnBefore()).toBe(false);
    expect(editor.commands.addColumnAfter()).toBe(false);
    expect(editor.commands.deleteColumn()).toBe(true);
    expect(TableMap.get(editor.state.doc.firstChild!).width).toBeLessThan(20);
    expect(editor.commands.insertTable({ rows: 2, cols: 21 })).toBe(false);
    editor.destroy();
  });
  it("rejects raw transactions and pasted 21-column tables, while allowing legacy content edits", () => {
    const plugin = new Plugin({ filterTransaction: tableTransactionWithinLimit });
    const doc = schema.nodeFromJSON({ type: "doc", content: [table(20)] });
    const state = EditorState.create({ schema, doc, plugins: [plugin] });
    const wider = schema.nodeFromJSON(table(21));
    expect(state.applyTransaction(state.tr.replaceWith(0, doc.content.size, wider)).transactions).toHaveLength(0);
    const legacy = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: [table(21)] }), plugins: [plugin] });
    expect(legacy.applyTransaction(legacy.tr.insertText("kept", 4)).transactions).toHaveLength(1);
    expect(legacy.applyTransaction(legacy.tr.replaceWith(0, legacy.doc.content.size, schema.nodeFromJSON(table(22)))).transactions).toHaveLength(0);
  });
  it("keeps the logical width independent of physical cells", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [table(20, true)] });
    const state = EditorState.create({ schema, doc, selection: TextSelection.near(doc.resolve(3)) });
    expect(doc.firstChild!.firstChild!.childCount).toBe(19);
    expect(selectedTableWidth(state)).toBe(20);
  });
});
