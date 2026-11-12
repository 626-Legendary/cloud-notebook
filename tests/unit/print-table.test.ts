import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderDocument } from "@/lib/render-document";
import { fontFamilies, resolveFontFamily, isSafeFontFamily } from "@/lib/editor-formatting";

describe("V3.1 print structure and font mapping", () => {
  it.each([[2, 2], [3, 5], [60, 8]])("retains every cell in a %i by %i table", (rows, cols) => {
    const table = { type: "table", content: Array.from({ length: rows }, (_, r) => ({
      type: "tableRow", content: Array.from({ length: cols }, (_, c) => ({
        type: r === 0 ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1 },
        content: [{ type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "text", text: `中文${r}:${c} long text `.repeat(3), marks: [
          { type: "bold" }, { type: "textStyle", attrs: { color: "#2563EB", fontFamily: fontFamilies[1].value } }, { type: "highlight", attrs: { color: "#FEF08A" } }
        ] }] }]
      }))
    })) };
    const html = renderToStaticMarkup(renderDocument(JSON.stringify({ type: "doc", content: [table] })));
    expect(html.match(/<tr>/g)).toHaveLength(rows);
    expect(html.match(/<(?:td|th) /g)).toHaveLength(rows * cols);
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("text-align:right");
    expect(html).toContain("<strong>");
    expect(html).toContain("color:#2563EB");
    expect(html).toContain("background-color:#FEF08A");
    expect(html).toContain("var(--font-noto-sans-sc)");
    expect(html).toContain(`中文${rows - 1}:${cols - 1}`);
  });

  it("retains merged cells and rejects unsafe span attributes", () => {
    const html = renderToStaticMarkup(renderDocument(JSON.stringify({ type: "table", content: [{ type: "tableRow", content: [
      { type: "tableCell", attrs: { colspan: 2, rowspan: 3 } }, { type: "tableCell", attrs: { colspan: -1, rowspan: "2 onclick=evil" } }
    ] }] })));
    expect(html).toContain('colSpan="2" rowSpan="3"');
    expect(html).not.toContain("evil");
    expect(html).not.toContain('colSpan="-1"');
  });

  it("maps all selectable fonts to stable variables while supporting legacy values", () => {
    expect(fontFamilies.filter((font) => font.type === "zh")).toHaveLength(8);
    expect(fontFamilies.filter((font) => font.type === "en")).toHaveLength(11);
    for (const font of fontFamilies.filter((font) => font.value)) expect(isSafeFontFamily(font.value)).toBe(true);
    expect(resolveFontFamily('Inter, "Noto Sans SC", sans-serif')).toBe("var(--font-inter), sans-serif");
    expect(resolveFontFamily('"Noto Serif SC", serif')).toBe("var(--font-noto-serif-sc), serif");
    expect(isSafeFontFamily("var(--untrusted)" )).toBe(false);
  });

  it("keeps old inline code rendering intact", () => {
    expect(renderToStaticMarkup(renderDocument(JSON.stringify({ type: "paragraph", content: [{ type: "text", text: "legacy", marks: [{ type: "code" }] }] })))).toContain("<code>legacy</code>");
  });
});
