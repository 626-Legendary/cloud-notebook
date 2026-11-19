import type { EditorState } from "@tiptap/pm/state";
export function canStartKnowledgeMention(state: EditorState, from: number, to: number) {
  if (from !== to) return false;
  const position = state.doc.resolve(from);
  if (!position.parent.isTextblock || position.parent.type.spec.code) return false;
  const marks = state.storedMarks ?? position.marks();
  if (marks.some((mark) => mark.type.name === "code" || mark.type.name === "link")) return false;
  const before = position.parent.textBetween(0, position.parentOffset, "\0", "\0");
  if (/(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S*$/i.test(before)) return false;
  return !before || /[\s（(【[「，。！？：；\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(before);
}

/** Only recover around the current caret after explicit manual/IME input, never on load or paste. */
export function knowledgeMentionAtSelection(state: EditorState) {
  if (!state.selection.empty) return null;
  const position = state.selection.$from;
  if (!position.parent.isTextblock || position.parent.type.spec.code || position.marks().some((mark) => ["code", "link"].includes(mark.type.name))) return null;
  const before = position.parent.textBetween(0, position.parentOffset, "\0", "\0");
  const index = before.lastIndexOf("@");
  if (index < 0) return null;
  const query = before.slice(index + 1);
  if (query.length > 120 || /[\s@\0]/.test(query)) return null;
  const from = position.start() + index;
  return canStartKnowledgeMention(state, from, from) ? { from, to: state.selection.from, query } : null;
}
