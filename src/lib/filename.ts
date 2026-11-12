const invalidFileNameCharacters = new Set('<>:"/\\|?*');

export function safeFileName(value: string, maxLength = 80) {
  const sanitized = Array.from(value, (character) => {
    const point = character.codePointAt(0) ?? 0;
    return invalidFileNameCharacters.has(character) || point < 32 ? "_" : character;
  }).join("");
  return sanitized.slice(0, maxLength) || "untitled";
}
