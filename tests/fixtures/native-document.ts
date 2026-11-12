export function nativeDocument(assetId: string) {
  const text = (value: string) => ({ type: "text", text: value });
  const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });
  return { type: "doc", content: [
    ...[1, 2, 3, 4, 5, 6].map((level) => ({ type: "heading", attrs: { level, textAlign: "right" }, content: [text(`标题 ${level}`)] })),
    { type: "paragraph", attrs: { textAlign: "justify" }, content: [{ ...text("字体、颜色和高亮 Rich text"), marks: [
      { type: "textStyle", attrs: { fontFamily: "var(--font-caveat), cursive", fontSize: "36px", color: "#123456" } },
      { type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }, { type: "highlight", attrs: { color: "#BFDBFE" } }
    ] }, { type: "hardBreak" }, { ...text("链接"), marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener noreferrer nofollow" } }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("无序列表")] }] },
    { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [paragraph("有序列表")] }] },
    { type: "blockquote", content: [paragraph("引用")] },
    { type: "codeBlock", attrs: { language: "typescript" }, content: [text("const value = 42;")] },
    { type: "horizontalRule" },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, rowspan: 1, colwidth: [100, 140], align: "center" }, content: [paragraph("合并表头")] }] },
      { type: "tableRow", content: ["第一列", "第二列"].map((value) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [100], align: "right" }, content: [paragraph(value)] })) }
    ] },
    { type: "image", attrs: { assetId, src: `/uploads/notes/${assetId}`, alt: "嵌入图片", title: "图片标题", width: 160, height: 86, alignment: "center", displayWidth: 70 } },
    { type: "paragraph", content: [{ ...text("旧文档行内代码"), marks: [{ type: "code" }] }] }
  ] };
}
