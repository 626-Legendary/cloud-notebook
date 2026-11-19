"use client";

import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Copy } from "lucide-react";
import { notify } from "@/lib/notifications";
import { createElement } from "react";
import type { RootContent } from "hast";

const lowlight = createLowlight(common);
const languages = [
  ["", "纯文本"], ["python", "Python"], ["javascript", "JavaScript"], ["typescript", "TypeScript"],
  ["json", "JSON"], ["xml", "HTML"], ["css", "CSS"], ["sql", "SQL"], ["bash", "Bash"],
  ["c", "C"], ["cpp", "C++"], ["java", "Java"], ["rust", "Rust"], ["go", "Go"],
];

function CopyCode({ text }: { text: string }) {
  return <button type="button" className="button-subtle" onClick={async () => {
    try { await navigator.clipboard.writeText(text); notify.success("已复制代码"); }
    catch { notify.error("无法复制代码"); }
  }}><Copy size={14} />复制代码</button>;
}

function EditableCodeBlock({ node, updateAttributes }: NodeViewProps) {
  const language = typeof node.attrs.language === "string" ? node.attrs.language : "";
  return <NodeViewWrapper className="document-code-block">
    <div className="code-block-toolbar" contentEditable={false}>
      <select className="control-input" aria-label="代码语言" value={language} onChange={(event) => updateAttributes({ language: event.target.value || null })}>
        {languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        {language && !languages.some(([value]) => value === language) && <option value={language}>{language}</option>}
      </select>
      <CopyCode text={node.textContent} />
    </div>
    <pre><NodeViewContent<"code"> as="code" style={{ whiteSpace: "pre" }} /></pre>
  </NodeViewWrapper>;
}

export const EditableCode = CodeBlockLowlight.extend({
  addNodeView() { return ReactNodeViewRenderer(EditableCodeBlock, { contentDOMElementTag: "span" }); },
}).configure({
  lowlight: {
    listLanguages: () => lowlight.listLanguages(),
    registered: (language: string) => lowlight.registered(language),
    highlight: (language: string, text: string) => lowlight.highlight(language, text),
    highlightAuto: (text: string) => lowlight.highlightAuto(text, { subset: [] }),
  },
});

function renderToken(node: RootContent, index: number): React.ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const classes = node.properties.className;
  return createElement("span", { key: index, className: Array.isArray(classes) ? classes.join(" ") : undefined }, node.children.map(renderToken));
}

export function ReadableCodeBlock({ text, language }: { text: string; language?: string }) {
  const tokens = language && lowlight.registered(language) ? lowlight.highlight(language, text).children : null;
  return <div className="document-code-block">
    <div className="code-block-toolbar">
      <span>{languages.find(([value]) => value === language)?.[1] ?? language ?? "纯文本"}</span>
      <CopyCode text={text} />
    </div>
    <pre><code>{tokens ? tokens.map(renderToken) : text}</code></pre>
  </div>;
}
