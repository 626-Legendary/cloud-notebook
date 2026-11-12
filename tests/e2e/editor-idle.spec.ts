import { test, expect, type Locator } from "@playwright/test";
import type { Editor } from "@tiptap/core";

type Probe = { transactions: number; optionUpdates: number; documentChanges: number; instance: Editor };
type ProbedElement = HTMLElement & { editor: Editor; idleProbe: Probe };

async function attachProbe(editor: Locator) {
  await editor.evaluate((element) => {
    const node = element as ProbedElement;
    const probe = { transactions: 0, optionUpdates: 0, documentChanges: 0, instance: node.editor };
    node.idleProbe = probe;
    node.editor.on("transaction", ({ transaction }) => {
      probe.transactions += 1;
      if (transaction.docChanged) probe.documentChanges += 1;
      const isOptionsUpdate = node.editor.state.plugins.some((plugin) => {
        const value: unknown = plugin.spec.key ? transaction.getMeta(plugin.spec.key) : undefined;
        return typeof value === "object" && value !== null && "type" in value && value.type === "updateOptions";
      });
      if (isOptionsUpdate) probe.optionUpdates += 1;
    });
  });
}

async function idleSample(editor: Locator) {
  return editor.evaluate((element) => {
    const node = element as ProbedElement;
    const { transactions, optionUpdates, documentChanges } = node.idleProbe;
    return { transactions, optionUpdates, documentChanges, sameInstance: node.editor === node.idleProbe.instance };
  });
}

async function expectIdle(editor: Locator) {
  // Let the interaction effects finish; then observe a genuine idle interval.
  await editor.page().waitForTimeout(250);
  const before = await idleSample(editor);
  await editor.page().waitForTimeout(3000);
  expect(await idleSample(editor)).toEqual(before);
  expect(before.sameInstance).toBe(true);
}

test("editor stays idle after focus, formatting, saving and page navigation", async ({ page, baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const headers = { Origin: baseURL }, password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `idle_${Date.now()}`, password, confirmPassword: password } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "空闲回归笔记本" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "空闲回归页面" } })).json();
  const { page: second } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "切换回归页面" } })).json();
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: note.version, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Idle regression text" }] }] } } })).ok()).toBe(true);
  let writes = 0;
  page.on("request", (request) => { if (request.method() === "PATCH" && request.url().includes(`/api/pages/${note.id}`)) writes += 1; });
  await page.goto(`/app?page=${note.id}`);
  const editor = page.locator(".notebook-editor");
  await expect(editor).toBeVisible();
  await attachProbe(editor);
  await editor.click();
  await expectIdle(editor);
  expect(writes).toBe(0);

  // Metadata-only plugins must not restart the toolbar's options-update loop.
  await editor.evaluate((element) => {
    const { editor } = element as ProbedElement;
    for (let index = 0; index < 20; index += 1) editor.view.dispatch(editor.state.tr.setMeta("idle-regression", index));
  });
  await expectIdle(editor);
  expect((await idleSample(editor)).optionUpdates).toBe(0);

  const bold = page.locator('.toolbar-formatting button[aria-label="加粗"]');
  await editor.press("Control+End");
  await editor.press("Control+b");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await editor.press("Control+b");
  await expect(bold).toHaveAttribute("aria-pressed", "false");

  await editor.fill("Edited idle regression");
  await editor.press("Control+a");
  await editor.press("Control+b");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "增大字号", exact: true }).click();
  await expect(editor.locator("span")).toHaveCSS("font-size", "18px");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator('span[style*="font-size"]')).toHaveCount(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(editor.locator("span")).toHaveCSS("font-size", "18px");
  await expectIdle(editor);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.content).toContain("Edited idle regression");
  await expectIdle(editor);
  expect((await idleSample(editor)).optionUpdates).toBe(0);
  await expect(editor).toHaveText("Edited idle regression");

  await page.locator(".page-row-open").filter({ hasText: "切换回归页面" }).click();
  await expect(page.getByLabel("页面标题", { exact: true })).toHaveValue(second.title);
  await attachProbe(editor);
  await editor.click();
  await expectIdle(editor);
  await page.locator(".page-row-open").filter({ hasText: "空闲回归页面" }).click();
  await expect(editor).toHaveText("Edited idle regression");
  await expect(editor.locator("strong")).toHaveText("Edited idle regression");
  await expect(editor.locator("span")).toHaveCSS("font-size", "18px");
});
