import { KnowledgeReference } from "@/lib/knowledge-reference";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Code from "@tiptap/extension-code";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize } from "@tiptap/extension-text-style";
import { LimitedTable } from "@/lib/table-limit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { resolveFontFamily } from "@/lib/editor-formatting";

const LegacyCode = Code.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules: () => [],
  addPasteRules: () => []
});

const assetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: { default: null, parseHTML: (element) => element.getAttribute("data-asset-id"), renderHTML: (attrs) => attrs.assetId ? { "data-asset-id": attrs.assetId } : {} },
      alignment: { default: "left", parseHTML: (element) => element.getAttribute("data-alignment") ?? "left", renderHTML: (attrs) => ({ "data-alignment": attrs.alignment }) },
      displayWidth: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("data-display-width")) || null,
        renderHTML: (attrs) => {
          const width = Number(attrs.displayWidth);
          return Number.isFinite(width) && width >= 20 && width <= 100
            ? { "data-display-width": String(width), style: `width: ${width}%; height: auto` }
            : {};
        }
      }
    };
  }
});


/** Shared by the live editor and native archive compatibility validation. */
export function documentExtensions(interactiveCode = false) {
  return [
      StarterKit.configure({ code: false, link: false, underline: false, ...(interactiveCode ? { codeBlock: false as const, trailingNode: { notAfter: ["codeBlock"] } } : {}) }),
      LegacyCode,
      KnowledgeReference,
      Underline,
      TextStyle,
      Color,
      FontFamily.extend({
        addGlobalAttributes() {
          return [{ types: ["textStyle"], attributes: { fontFamily: { default: null, parseHTML: (element) => element.style.fontFamily, renderHTML: (attrs) => attrs.fontFamily ? { style: `font-family: ${resolveFontFamily(attrs.fontFamily)}` } : {} } } }];
        }
      }),
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"], defaultAlignment: "left" }),
      Highlight.extend({
        addAttributes() {
          const attributes: Record<string, object> = this.parent?.() ?? {};
          return { ...attributes, color: { ...attributes.color, renderHTML: (attrs) => attrs.color ? {
            "data-color": attrs.color,
            style: `background-color: ${attrs.color}; --highlight-color: ${attrs.color}; color: inherit`
          } : {} } };
        }
      }).configure({ multicolor: true }),
      Link.configure({ openOnClick: false, protocols: ["http", "https", "mailto"] }),
      assetImage.configure({ inline: false, allowBase64: false }),
      LimitedTable.configure({ resizable: true, allowTableNodeSelection: true }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown,
  ];
}
