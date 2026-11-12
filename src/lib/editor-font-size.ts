import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export const fontSizeSteps = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96] as const;

export function nextFontSize(value: number, direction: -1 | 1) {
  if (direction > 0) return fontSizeSteps.find((size) => size > value) ?? null;
  return [...fontSizeSteps].reverse().find((size) => size < value) ?? null;
}

export function adjustSelectedFontSizes(editor: Editor, direction: -1 | 1) {
  const transaction = createFontSizeAdjustment(editor.state, direction);
  if (!transaction) return false;
  editor.view.dispatch(transaction);
  editor.view.focus();
  return true;
}

export function createFontSizeAdjustment(state: EditorState, direction: -1 | 1): Transaction | null {
  const { from, to, empty, $from } = state.selection;
  const markType = state.schema.marks.textStyle;
  if (!markType) return null;
  let transaction = state.tr;

  if (empty) {
    const marks = state.storedMarks ?? $from.marks();
    const currentMark = markType.isInSet(marks);
    const currentSize = parseFontSize(currentMark?.attrs.fontSize) ?? defaultBlockFontSize($from.parent);
    const next = nextFontSize(currentSize, direction);
    if (next === null) return null;
    const attributes = { ...(currentMark?.attrs ?? {}), fontSize: `${next}px` };
    transaction = transaction.addStoredMark(markType.create(attributes));
  } else {
    const ranges: { from: number; to: number; attributes: Record<string, unknown>; size: number }[] = [];
    state.doc.nodesBetween(from, to, (node, position) => {
      if (!node.isText) return;
      const start = Math.max(from, position);
      const end = Math.min(to, position + node.nodeSize);
      if (end <= start) return;
      const mark = markType.isInSet(node.marks);
      ranges.push({
        from: start,
        to: end,
        attributes: { ...(mark?.attrs ?? {}) },
        size: parseFontSize(mark?.attrs.fontSize) ?? defaultBlockFontSize(state.doc.resolve(start).parent)
      });
    });
    for (const range of ranges) {
      const next = nextFontSize(range.size, direction);
      if (next !== null) {
        transaction = transaction.addMark(range.from, range.to, markType.create({
          ...range.attributes,
          fontSize: `${next}px`
        }));
      }
    }
    if (!ranges.length || !transaction.docChanged) return null;
  }
  return transaction;
}

export function parseFontSize(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:px)?$/.exec(value.trim());
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isInteger(size) && size >= 8 && size <= 96 ? size : null;
}

export function selectedFontSizeRange(state: EditorState) {
  const { from, to, empty, $from } = state.selection;
  const markType = state.schema.marks.textStyle;
  if (!markType) return { minimum: 16, maximum: 16 };
  if (empty) {
    const mark = markType.isInSet(state.storedMarks ?? $from.marks());
    const size = parseFontSize(mark?.attrs.fontSize) ?? defaultBlockFontSize($from.parent);
    return { minimum: size, maximum: size };
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText) return;
    const mark = markType.isInSet(node.marks);
    const size = parseFontSize(mark?.attrs.fontSize) ?? defaultBlockFontSize(state.doc.resolve(position).parent);
    minimum = Math.min(minimum, size);
    maximum = Math.max(maximum, size);
  });
  return Number.isFinite(minimum) ? { minimum, maximum } : { minimum: 16, maximum: 16 };
}

function defaultBlockFontSize(node: { type: { name: string }; attrs: Record<string, unknown> }) {
  return node.type.name === "heading" ? ({ 1: 30, 2: 24, 3: 20 }[Number(node.attrs.level)] ?? 16) : 16;
}
