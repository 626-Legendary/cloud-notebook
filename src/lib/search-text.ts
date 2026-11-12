export function extractSearchableText(content: string): string {
  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    return "";
  }
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const value = node as { text?: unknown; content?: unknown };
    if (typeof value.text === "string") parts.push(value.text);
    if (value.content !== undefined) {
      visit(value.content);
      parts.push(" ");
    }
  };
  visit(document);
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function createSearchSnippet(text: string, query: string, contextLength = 90) {
  const normalizedText = text.toLocaleLowerCase();
  const index = normalizedText.indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, contextLength);
  const start = Math.max(0, index - Math.floor((contextLength - query.length) / 2));
  const end = Math.min(text.length, start + contextLength);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
