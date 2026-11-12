import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export function findTextRanges(doc: ProseMirrorNode, query: string) {
  if (!query) return [];
  const matches: { from: number; to: number }[] = [];
  const needle = query.toLocaleLowerCase();
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return;
    let text = "";
    const ranges: { start: number; end: number; from: number }[] = [];
    block.descendants((node, pos) => {
      if (node.isText) {
        const start = text.length;
        text += node.text ?? "";
        ranges.push({ start, end: text.length, from: blockPos + 1 + pos });
      } else if (node.isInline) {
        text += "\u0000";
      }
    });
    const normalized = text.toLocaleLowerCase();
    let index = normalized.indexOf(needle);
    while (index >= 0) {
      const matchEnd = index + needle.length;
      const startRange = ranges.find((range) => index >= range.start && index < range.end);
      const endRange = [...ranges].reverse().find((range) => matchEnd > range.start && matchEnd <= range.end);
      if (startRange && endRange) {
        matches.push({
          from: startRange.from + index - startRange.start,
          to: endRange.from + matchEnd - endRange.start
        });
      }
      index = normalized.indexOf(needle, index + Math.max(needle.length, 1));
    }
  });
  return matches;
}
