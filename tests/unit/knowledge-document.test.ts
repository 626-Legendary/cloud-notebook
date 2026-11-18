import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { documentExtensions } from "@/lib/editor-extensions";
import { canStartKnowledgeMention } from "@/lib/knowledge-trigger";
import { documentReferences, mapKnowledgeReferences, normalizeKnowledgeName, replaceReferenceAtPath } from "@/lib/knowledge-document";
const schema = getSchema(documentExtensions());
function state(text: string, type = "paragraph", marks: string[] = []) {
  const doc = schema.node("doc", null, [schema.node(type, null, text ? schema.text(text, marks.map((name) => schema.mark(name, name === "link" ? { href: "https://example.test" } : undefined))) : undefined)]);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, text.length + 1) });
}
describe("manual mention trigger boundaries", () => {
  it("accepts paragraph starts and punctuation/space but excludes emails, URLs and repeated @", () => {
    for (const text of ["", "前文 ", "前文（"]) { const current = state(text); expect(canStartKnowledgeMention(current, current.selection.from, current.selection.to)).toBe(true); }
    for (const text of ["user", "hello", "@", "https://site/", "test@", "@ ".trimEnd()]) { const current = state(text); expect(canStartKnowledgeMention(current, current.selection.from, current.selection.to)).toBe(false); }
  });
  it("excludes code blocks, inline code, existing links and nonempty selections", () => {
    for (const [type, marks] of [["codeBlock", []], ["paragraph", ["code"]], ["paragraph", ["link"]]] as const) { const current = state(" ", type, [...marks]); expect(canStartKnowledgeMention(current, current.selection.from, current.selection.to)).toBe(false); }
    expect(canStartKnowledgeMention(state("some text"), 1, 4)).toBe(false);
  });
});
it("maps IDs only on reference nodes and repairs exactly the selected path", () => {
  const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "knowledgeReference", attrs: { entryId: "old", label: "相同", referenceType: "entry" } }, { type: "knowledgeReference", attrs: { entryId: "old", label: "相同", referenceType: "entry" } }, { type: "text", text: "old" }] }] };
  const repaired = replaceReferenceAtPath(document, [0, 1], { entryId: "old", label: "相同" }, null);
  expect(documentReferences(repaired)).toHaveLength(1); expect(documentReferences(document)).toHaveLength(2);
  expect(JSON.stringify(mapKnowledgeReferences(document, () => "new"))).toContain('"text":"old"');
  expect(() => replaceReferenceAtPath(document, [0, 2], { entryId: "old", label: "相同" }, null)).toThrow("位置");
  expect(normalizeKnowledgeName("  ＯＳ  ")).toBe("os");
});
