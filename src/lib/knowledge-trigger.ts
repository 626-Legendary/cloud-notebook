import type { EditorState } from "@tiptap/pm/state";
export function canStartKnowledgeMention(state: EditorState, from: number, to: number) {
  if (from !== to) return false;
  const position = state.doc.resolve(from);
  if (!position.parent.isTextblock || position.parent.type.spec.code) return false;
  const marks = state.storedMarks ?? position.marks();
  if (marks.some((mark) => mark.type.name === "code" || mark.type.name === "link")) return false;
  const before = position.parent.textBetween(0, position.parentOffset, "\0", "\0");
  return !before || /[\s（(【[「，。！？：；]$/.test(before);
}
