function splitRow(line: string) {
  const cells: string[] = [];
  let value = "";
  let escaped = false;
  let content = line.trim();
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|") && !content.endsWith("\\|")) content = content.slice(0, -1);

  for (const character of content) {
    if (escaped) {
      value += character === "|" ? "|" : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (escaped) value += "\\";
  cells.push(value.trim());
  return cells;
}

function isSeparatorCell(value: string) {
  return /^:?-{3,}:?$/.test(value.replace(/\s/g, ""));
}

export function parseMarkdownTable(markdown: string) {
  const lines = markdown.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const separator = splitRow(lines[1]);
  if (!header.length || separator.length !== header.length || !separator.every(isSeparatorCell)) return null;
  const rows = lines.slice(2).map(splitRow);
  if (rows.some((row) => row.length !== header.length)) return null;
  return [header, ...rows];
}
