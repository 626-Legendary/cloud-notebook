import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isSafeFontFamily } from "@/lib/editor-formatting";
import { renderDocument } from "@/lib/render-document";

describe("editor formatting", () => {
  it("allows configured and legacy font families but rejects arbitrary CSS", () => {
    expect(isSafeFontFamily('Inter, "Noto Sans SC", sans-serif')).toBe(true);
    expect(isSafeFontFamily("Georgia,serif")).toBe(true);
    expect(isSafeFontFamily("url(https://example.com/font)")).toBe(false);
  });

  it("preserves text styles, block alignment, and existing image widths in print output", () => {
    const content = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [{
            type: "text",
            text: "Formatted",
          marks: [
            { type: "textStyle", attrs: { fontSize: "18px", fontFamily: "Georgia,serif", color: "#2563EB" } },
            { type: "highlight", attrs: { color: "#DDD6FE" } }
          ]
          }]
        },
        {
          type: "image",
          attrs: { src: "/uploads/notes/123e4567-e89b-12d3-a456-426614174000", width: 240 }
        }
      ]
    });

    const markup = renderToStaticMarkup(renderDocument(content));
    expect(markup).toContain('text-align:center');
    expect(markup).toContain('font-size:18px');
    expect(markup).toContain('font-family:Georgia,serif');
    expect(markup).toContain('color:#2563EB');
    expect(markup).toContain('background-color:#DDD6FE');
    expect(markup).toContain('width:240px');
  });
});

it("rendered external links open a separate tab and reject unsafe link schemes", () => {
  const paragraph = (href: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "维基百科", marks: [{ type: "link", attrs: { href } }] }] }] });
  const html = renderToStaticMarkup(renderDocument(JSON.stringify(paragraph("https://zh.wikipedia.org/wiki/Docker"))));
  expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noopener noreferrer"');
  expect(renderToStaticMarkup(renderDocument(JSON.stringify(paragraph("javascript:alert(1)"))))).not.toContain("<a");
});
