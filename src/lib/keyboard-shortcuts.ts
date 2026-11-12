/** Match modifiers exactly; Shift+K must never also trigger the plain K command. */
export function matchesShortcut(event: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
  defaultPrevented?: boolean; isComposing?: boolean;
}, key: string, shift = false) {
  return !event.defaultPrevented && !event.isComposing && !event.altKey &&
    (event.ctrlKey !== event.metaKey) && event.shiftKey === shift && event.key.toLowerCase() === key;
}
