import React from "react";
import Image from "next/image";
import { isSafeFontFamily, resolveFontFamily } from "@/lib/editor-formatting";

const safeImagePath = /^\/uploads\/notes\/[0-9a-f-]{36}$/i;
const safeColor = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i;

export function renderDocument(raw: string): React.ReactNode {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return <p>正文格式无法读取</p>; }
  if (!value || typeof value !== "object") return null;
  return renderNode(value as DocNode, "root");
}

type DocNode = {
  type?: string;
  text?: string;
  content?: DocNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

function renderNode(node: DocNode, key: React.Key): React.ReactNode {
  if (node.type === "text") {
    let output: React.ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") output = <strong key={`${String(key)}-b`}>{output}</strong>;
      else if (mark.type === "italic") output = <em key={`${String(key)}-i`}>{output}</em>;
      else if (mark.type === "underline") output = <u key={`${String(key)}-u`}>{output}</u>;
      else if (mark.type === "strike") output = <s key={`${String(key)}-s`}>{output}</s>;
      else if (mark.type === "code") output = <code key={`${String(key)}-c`}>{output}</code>;
      else if (mark.type === "link") {
        const href = safeHref(mark.attrs?.href);
        if (href) output = <a key={`${String(key)}-a`} href={href} target="_blank" rel="noopener noreferrer">{output}</a>;
      } else if (mark.type === "highlight") output = <mark key={`${String(key)}-h`} style={{ backgroundColor: safeStyleColor(mark.attrs?.color) }}>{output}</mark>;
      else if (mark.type === "textStyle") {
        const color = safeStyleColor(mark.attrs?.color);
        const fontSize = typeof mark.attrs?.fontSize === "string" && /^\d{1,2}px$/.test(mark.attrs.fontSize) ? mark.attrs.fontSize : undefined;
        const fontFamily = isSafeFontFamily(mark.attrs?.fontFamily) ? resolveFontFamily(mark.attrs.fontFamily) : undefined;
        output = <span key={`${String(key)}-ts`} style={{ color, fontSize, fontFamily }}>{output}</span>;
      }
    }
    return <React.Fragment key={key}>{output}</React.Fragment>;
  }
  const children = (node.content ?? []).map((child, index) => renderNode(child, `${String(key)}-${index}`));
  switch (node.type) {
    case "knowledgeReference": return <span key={key} className={`knowledge-reference${node.attrs?.unresolved ? " knowledge-reference-invalid" : ""}`} data-knowledge-reference="entry" data-entry-id={String(node.attrs?.entryId ?? "")}>@{String(node.attrs?.label ?? "失效引用")}</span>;
    case "doc": return <>{children}</>;
    case "paragraph": return <p key={key} style={safeAlignment(node.attrs?.textAlign)}>{children}</p>;
    case "heading": {
      const level = Number(node.attrs?.level);
      if (level === 1) return <h1 key={key} style={safeAlignment(node.attrs?.textAlign)}>{children}</h1>;
      if (level === 2) return <h2 key={key} style={safeAlignment(node.attrs?.textAlign)}>{children}</h2>;
      return <h3 key={key} style={safeAlignment(node.attrs?.textAlign)}>{children}</h3>;
    }
    case "table": {
      const rows = node.content ?? [];
      const header = rows[0]?.content?.length && rows[0].content.every((cell) => cell.type === "tableHeader");
      return <table key={key}>
        {header ? <thead>{renderNode(rows[0], `${String(key)}-header`)}</thead> : null}
        <tbody>{rows.slice(header ? 1 : 0).map((row, index) => renderNode(row, `${String(key)}-row-${index}`))}</tbody>
      </table>;
    }
    case "tableRow": return <tr key={key}>{children}</tr>;
    case "tableHeader":
    case "tableCell": {
      const Tag = node.type === "tableHeader" ? "th" : "td";
      return <Tag key={key} colSpan={safeSpan(node.attrs?.colspan)} rowSpan={safeSpan(node.attrs?.rowspan)} style={safeAlignment(node.attrs?.textAlign)}>{children}</Tag>;
    }
    case "bulletList": return <ul key={key}>{children}</ul>;
    case "orderedList": return <ol key={key}>{children}</ol>;
    case "listItem": return <li key={key}>{children}</li>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock": return <pre key={key}><code>{children}</code></pre>;
    case "horizontalRule": return <hr key={key} />;
    case "hardBreak": return <br key={key} />;
    case "image": {
      const src = typeof node.attrs?.src === "string" && safeImagePath.test(node.attrs.src) ? node.attrs.src : "";
      if (!src) return null;
      const width = Number(node.attrs?.displayWidth);
      const originalWidth = Number(node.attrs?.width);
      const alignment = node.attrs?.alignment;
      const displayWidth = Number.isFinite(width) && width >= 20 && width <= 100
        ? `${width}%`
        : Number.isFinite(originalWidth) && originalWidth > 0 ? `${originalWidth}px` : undefined;
      return <Image key={key} className={`print-image align-${alignment === "center" || alignment === "right" ? alignment : "left"}`} src={src} alt={typeof node.attrs?.alt === "string" ? node.attrs.alt.slice(0, 200) : ""} width={900} height={700} unoptimized loading="eager" style={{ width: displayWidth, height: "auto" }} />;
    }
    default: return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

function safeAlignment(value: unknown): React.CSSProperties | undefined {
  if (value === "left" || value === "center" || value === "right" || value === "justify") return { textAlign: value };
  return undefined;
}

function safeHref(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, "https://local.invalid");
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : undefined;
  } catch { return undefined; }
}

function safeStyleColor(value: unknown) {
  return typeof value === "string" && safeColor.test(value) ? value : undefined;
}

function safeSpan(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100 ? value : undefined;
}
