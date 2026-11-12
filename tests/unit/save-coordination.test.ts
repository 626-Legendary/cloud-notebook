import { describe, expect, it } from "vitest";
import { autoSaveDelay, normalizeAutoSaveMode } from "@/lib/auto-save";
import { serializePageSave, waitForPageSaves, registerPageFlush, flushPageEdits } from "@/lib/page-save-queue";
import { breadcrumbTitle } from "@/lib/display-title";

describe("save coordination", () => {
  it("serializes same-page writes and lets navigation wait for their acknowledgements", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const first = serializePageSave("a", async () => { order.push("write1"); await gate; order.push("ack1"); });
    const second = serializePageSave("a", async () => { order.push("write2"); order.push("ack2"); });
    const navigation = waitForPageSaves("a").then(() => order.push("navigate"));
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(["write1"]);
    release(); await Promise.all([first, second, navigation]);
    expect(order).toEqual(["write1", "ack1", "write2", "ack2", "navigate"]);
  });
  it("does not block a different page or leave a rejected write locking the queue", async () => {
    let release!: () => void;
    const first = serializePageSave("blocked", () => new Promise<void>((resolve) => { release = resolve; }));
    expect(await serializePageSave("other", async () => 42)).toBe(42);
    release(); await first;
    await expect(serializePageSave("failed", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await serializePageSave("failed", async () => "retry")).toBe("retry");
    await waitForPageSaves("failed");
  });
  it("flushes dirty editor data before same-tab version-changing operations", async () => {
    const events: string[] = [];
    const dispose = registerPageFlush("rename", async () => {
      await serializePageSave("rename", async () => { events.push("saved"); });
    });
    await flushPageEdits("rename"); events.push("rename");
    expect(events).toEqual(["saved", "rename"]);
    dispose(); await flushPageEdits("rename");
    expect(events).toHaveLength(2);
  });
  it("uses ten seconds by default and supports minute intervals without rewriting legacy settings", () => {
    expect(autoSaveDelay("realtime")).toBe(10_000);
    expect(autoSaveDelay("10s")).toBe(10_000);
    expect(autoSaveDelay("30s")).toBe(10_000);
    expect(autoSaveDelay("60s")).toBe(60_000);
    expect(autoSaveDelay("300s")).toBe(300_000);
    expect(autoSaveDelay("600s")).toBe(600_000);
    expect(autoSaveDelay("off")).toBeNull();
    expect(normalizeAutoSaveMode("unknown")).toBe("realtime");
  });
  it("limits breadcrumb labels by characters while preserving complete short titles", () => {
    expect(breadcrumbTitle("a".repeat(60))).toBe("a".repeat(60));
    expect(breadcrumbTitle("a".repeat(61))).toBe("a".repeat(60) + "...");
    expect(breadcrumbTitle("🙂".repeat(61))).toBe("🙂".repeat(60) + "...");
  });
});
