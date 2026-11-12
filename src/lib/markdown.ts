function markdownFromNode(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[] };
  if (value.type === "text") {
    let text = value.text ?? "";
    for (const mark of value.marks ?? []) {
      if (mark.type === "bold") text = `**${text}**`;
      if (mark.type === "italic") text = `_${text}_`;
      if (mark.type === "strike") text = `~~${text}~~`;
      if (mark.type === "code") text = `\`${text}\``;
    }
    return text;
  }
  const children = (value.content ?? []).map(markdownFromNode).join("");
  switch (value.type) {
    case "heading": return `${"#".repeat(Number(value.attrs?.level ?? 1))} ${children}\n\n`;
    case "paragraph": return `${children}\n\n`;
    case "bulletList": return children;
    case "orderedList": return children;
    case "listItem": return `- ${children.trim()}\n`;
    case "blockquote": return children.split("\n").map((line) => `> ${line}`).join("\n");
    case "codeBlock": return `\`\`\`\n${children}\n\`\`\`\n\n`;
    case "horizontalRule": return "---\n\n";
    case "image": return `![图片](${String(value.attrs?.src ?? "")})\n\n`;
    case "hardBreak": return "\n";
    default: return children;
  }
}

export function contentToMarkdown(json: string) {
  try { return markdownFromNode(JSON.parse(json)).trim() + "\n"; }
  catch { return ""; }
}
