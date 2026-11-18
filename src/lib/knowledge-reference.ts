import { Node, mergeAttributes } from "@tiptap/core";

/** Portable JSON/HTML node; client views resolve names without rewriting saved documents. */
export const KnowledgeReference = Node.create({
  name: "knowledgeReference", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() {
    return {
      entryId: { default: "", parseHTML: (element) => element.getAttribute("data-entry-id") ?? "" },
      label: { default: "失效引用", parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent?.replace(/^@/, "") ?? "失效引用" },
      referenceType: { default: "entry", parseHTML: () => "entry" }
    };
  },
  parseHTML() { return [{ tag: 'span[data-knowledge-reference="entry"]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-knowledge-reference": "entry", "data-entry-id": node.attrs.entryId, "data-label": node.attrs.label, class: "knowledge-reference" }), `@${node.attrs.label}`];
  },
  renderText({ node }) { return `@${node.attrs.label}`; }
});
