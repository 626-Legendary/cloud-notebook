import { describe, expect, it } from "vitest";
import { matchesShortcut } from "@/lib/keyboard-shortcuts";
const base = { key: "k", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
describe("exact editor shortcuts", () => {
  it("keeps link, page find and workspace find mutually exclusive", () => {
    expect(matchesShortcut(base, "k")).toBe(true);
    expect(matchesShortcut({ ...base, shiftKey: true }, "k")).toBe(false);
    expect(matchesShortcut({ ...base, key: "f" }, "f")).toBe(true);
    expect(matchesShortcut({ ...base, key: "F", shiftKey: true }, "f", true)).toBe(true);
    expect(matchesShortcut({ ...base, key: "F", shiftKey: true }, "f")).toBe(false);
    expect(matchesShortcut({ ...base, key: "f" }, "f", true)).toBe(false);
  });
  it("supports Cmd and ignores composition, Alt and already-handled events", () => {
    expect(matchesShortcut({ ...base, ctrlKey: false, metaKey: true }, "k")).toBe(true);
    expect(matchesShortcut({ ...base, ctrlKey: false }, "k")).toBe(false);
    expect(matchesShortcut({ ...base, metaKey: true }, "k")).toBe(false);
    expect(matchesShortcut({ ...base, altKey: true }, "k")).toBe(false);
    expect(matchesShortcut({ ...base, isComposing: true }, "k")).toBe(false);
    expect(matchesShortcut({ ...base, defaultPrevented: true }, "k")).toBe(false);
  });
});
