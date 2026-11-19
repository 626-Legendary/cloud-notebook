import { afterEach, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { documentExtensions } from "@/lib/editor-extensions";
import { createKnowledgeMentionPlugin, knowledgeMentionKey as key } from "@/lib/knowledge-mention-plugin";
const schema = getSchema(documentExtensions());
function setup(text = "", type = "paragraph") {
  const doc = schema.node("doc", null, [schema.node(type, null, text ? schema.text(text) : undefined)]);
  const changed = vi.fn(), pressed = vi.fn(() => true);
  const plugin = createKnowledgeMentionPlugin(changed, pressed);
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, text.length+1), plugins: [plugin] });
  const dispatch = (tr: Transaction) => { const previous = state; state = state.apply(tr); pluginView.update?.(view, previous); };
  const view = { get state() { return state; }, composing: false, dispatch } as unknown as EditorView;
  const pluginView = plugin.spec.view!(view);
  const input = (text: string) => plugin.props.handleTextInput!.call(plugin, view, state.selection.from, state.selection.to, text, () => state.tr.insertText(text));
  const start = () => plugin.props.handleDOMEvents!.compositionstart!.call(plugin, view, {} as CompositionEvent);
  const end = () => { plugin.props.handleDOMEvents!.compositionend!.call(plugin, view, {} as CompositionEvent); vi.runAllTimers(); };
  return { view, plugin, input, start, end, changed, pressed, destroy: () => pluginView.destroy?.() };
}
afterEach(() => vi.useRealTimers());
it("starts after a manual batched @Chinese input and after adjacent CJK text, but excludes URLs and emails", () => {
  for (const prefix of ["", "了解", "前文 "]) { const context=setup(prefix); expect(context.input("@内存")).toBe(true); expect(key.getState(context.view.state)?.query).toBe("内存"); context.destroy(); }
  for (const prefix of ["user", "https://site/内存", "@"]) { const context=setup(prefix); expect(context.input("@内存")).toBe(false); context.destroy(); }
});
it("recovers a full IME commit without creating or confirming during composition", () => {
  vi.useFakeTimers(); const context=setup(); context.start();
  context.view.dispatch(context.view.state.tr.insertText("@内存"));
  expect(context.plugin.props.handleKeyDown!.call(context.plugin,context.view,{key:"Enter",isComposing:true} as KeyboardEvent)).toBe(false); expect(context.pressed).not.toHaveBeenCalled();
  context.end(); expect(key.getState(context.view.state)).toEqual({from:1,to:4,query:"内存"}); expect(context.changed).toHaveBeenLastCalledWith({from:1,to:4,query:"内存"}); context.destroy();
});
it("keeps the trigger anchored when IME replaces @ or temporarily removes it", () => {
  vi.useFakeTimers(); const context=setup(); context.input("@"); context.start();
  context.view.dispatch(context.view.state.tr.insertText("n",1,2)); context.view.dispatch(context.view.state.tr.insertText("@内存",1,2)); context.end();
  expect(key.getState(context.view.state)?.query).toBe("内存"); context.destroy();
});
it("does not revive an escaped mention or activate an untouched pasted/loaded string", () => {
  vi.useFakeTimers(); const context=setup(); context.input("@"); context.view.dispatch(context.view.state.tr.setMeta(key,"close")); context.start(); context.view.dispatch(context.view.state.tr.insertText("内存")); context.end(); expect(key.getState(context.view.state)).toBeNull(); context.destroy();
  const loaded=setup("@内存"); loaded.start(); loaded.end(); expect(key.getState(loaded.view.state)).toBeNull(); loaded.destroy();
  const code=setup("", "codeBlock"); code.start(); code.view.dispatch(code.view.state.tr.insertText("@内存")); code.end(); expect(key.getState(code.view.state)).toBeNull(); code.destroy();
});
it("cancels the event-owned deferred commit when the editor is destroyed", () => {
  vi.useFakeTimers(); const context=setup(); context.start(); context.view.dispatch(context.view.state.tr.insertText("@内存")); context.plugin.props.handleDOMEvents!.compositionend!.call(context.plugin,context.view,{} as CompositionEvent); context.destroy(); vi.runAllTimers(); expect(context.changed).not.toHaveBeenCalled();
});

it("resumes composition after another editor plugin causes view recreation", () => {
  vi.useFakeTimers(); const context=setup(); context.destroy(); const recreated=context.plugin.spec.view!(context.view);
  context.start(); context.view.dispatch(context.view.state.tr.insertText("@内存")); context.end(); expect(key.getState(context.view.state)?.query).toBe("内存"); recreated.destroy?.();
});

it("allows a fresh IME trigger after the escaped trigger was deleted", () => {
  vi.useFakeTimers(); const context=setup(); context.input("@"); context.view.dispatch(context.view.state.tr.setMeta(key,"close"));
  context.view.dispatch(context.view.state.tr.delete(1,2)); context.start(); context.view.dispatch(context.view.state.tr.insertText("@内存")); context.end(); expect(key.getState(context.view.state)?.query).toBe("内存"); context.destroy();
});
