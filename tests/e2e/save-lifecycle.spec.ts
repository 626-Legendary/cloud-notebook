import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

async function createNote(page: Page, baseURL: string, title = "Save lifecycle") {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || !["3001", "3002"].includes(new URL(baseURL).port)) throw new Error("Disposable test server required");
  const headers = { Origin: baseURL };
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `save_${Date.now()}`, password: "BrowserTest12345", confirmPassword: "BrowserTest12345" } })).ok()).toBeTruthy();
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "Lifecycle notebook" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title } })).json();
  return { note, notebook, headers };
}

test("loading, version, compact labels, unpin and nine new real fonts", async ({ page, baseURL }, testInfo) => {
  await page.goto("/login");
  await expect(page.locator(".environment-test")).toHaveText("测试版");
  await page.screenshot({ path: testInfo.outputPath("test-login.png") });
  const { note, headers } = await createNote(page, baseURL!, "A".repeat(70));
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Font test 字體測試 中文 English" }] }] };
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: note.version, content } })).ok()).toBeTruthy();
  await page.request.post("/api/pins", { headers, data: { type: "page", id: note.id } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/me", async (route) => { await gate; await route.continue(); });
  await page.goto(`/app?page=${note.id}`);
  await expect(page.locator(".workspace-loading").first()).toBeVisible();
  await expect(page.getByText("尚未选择笔记本", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("refresh-loading.png") });
  release();
  await expect(page.locator(".notebook-editor")).toBeVisible();
  await expect(page.locator(".workspace .environment-badge")).toHaveCount(0);
  await expect(page.getByLabel("应用版本")).toHaveText("Ver 1.1.1119d");
  await page.screenshot({ path: testInfo.outputPath("workspace-version.png") });
  await expect(page.locator('.breadcrumbs [aria-current="page"]')).toHaveText("A".repeat(60) + "...");
  await expect(page.locator('.breadcrumbs [aria-current="page"]')).toHaveAttribute("title", "A".repeat(70));
  await expect(page.getByLabel("搜索页面", { exact: true })).toHaveCount(0);
  await page.getByLabel(`${"A".repeat(70)} 置顶操作`, { exact: true }).click();
  await page.getByRole("menuitem", { name: "取消置顶", exact: true }).click();
  await expect(page.locator(".pinned-section")).toHaveCount(0);
  const options = page.getByRole("combobox", { name: "字体", exact: true });
  expect(await options.locator("option").allTextContents()).not.toContain("云笔记 Aa");
  expect((await options.textContent())!).not.toContain("Noto Sans SC");
  const fonts = [
    ["jf-open-huninn", "sans-serif"], ["zhi-mang-xing", "cursive"], ["long-cang", "cursive"],
    ["montserrat", "sans-serif"], ["poppins", "sans-serif"], ["plus-jakarta-sans", "sans-serif"],
    ["lora", "serif"], ["cinzel", "serif"], ["caveat", "cursive"]
  ];
  const report: unknown[] = [];
  for (const [id, fallback] of fonts) {
    await page.locator(".notebook-editor").click(); await page.keyboard.press("Control+a");
    await options.selectOption(`var(--font-${id}), ${fallback}`);
    const span = page.locator(".notebook-editor p span");
    await span.evaluate(async (element) => { const s = getComputedStyle(element); await document.fonts.load(`${s.fontSize} ${s.fontFamily.split(",")[0]}`, element.textContent!); });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".notebook-editor p span" });
    const rendered = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(rendered.fonts.some((font) => font.isCustomFont && font.glyphCount > 0)).toBe(true);
    report.push({ id, fonts: rendered.fonts }); await cdp.detach();
  }
  await writeFile(testInfo.outputPath("new-fonts.json"), JSON.stringify(report, null, 2));
  await testInfo.attach("new-fonts", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  await page.getByTitle("导出 / 打印", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "选择导出范围" }).locator("button svg")).toHaveCount(1); // close icon only
  await expect(page.getByRole("button", { name: "打印 / 保存为 PDF", exact: true }).locator("svg")).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.content).toContain("--font-caveat");
  await page.goto(`/print/page/${note.id}`);
  await expect(page.getByRole("button", { name: "打印 / 保存为 PDF", exact: true }).locator("svg")).toHaveCount(0);
  const toolbar = await page.locator(".print-toolbar").boundingBox(); const button = await page.getByRole("button", { name: "打印 / 保存为 PDF", exact: true }).boundingBox();
  expect(button!.x).toBeGreaterThan(toolbar!.x + toolbar!.width / 2);
  await expect(page.locator(".print-toolbar")).toHaveCSS("border-bottom-width", "1px");
  await page.screenshot({ path: testInfo.outputPath("print-toolbar.png") });
});

test("slow saves serialize, 10-second autosave and genuine external conflicts remain protected", async ({ page, baseURL }, testInfo) => {
  const { note, headers } = await createNote(page, baseURL!);
  await page.goto(`/app?page=${note.id}`);
  const editor = page.locator(".notebook-editor");
  await expect(editor).toBeVisible();
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0; let active = 0; let maximum = 0;
  const versions: number[] = []; const statuses: number[] = [];
  await page.route(`**/api/pages/${note.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    calls++; active++; maximum = Math.max(maximum, active);
    versions.push(route.request().postDataJSON().version);
    const response = await route.fetch(); statuses.push(response.status());
    if (calls === 1) await gate;
    active--; await route.fulfill({ response });
  });
  await editor.fill("First save 字体");
  await page.keyboard.press("Control+s");
  await expect.poll(() => statuses.length).toBe(1);
  await editor.click(); await page.keyboard.press("Control+a");
  await page.getByRole("combobox", { name: "字体", exact: true }).selectOption("var(--font-merriweather), serif");
  await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" newer edits");
  await page.keyboard.press("Control+s"); await page.keyboard.press("Control+s");
  expect(calls).toBe(1);
  // Reopening the notebook destroys the old editor while its response is held.
  await page.locator(".sidebar").getByRole("button", { name: "Lifecycle notebook", exact: true }).click();
  release();
  await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.content).toContain("newer edits");
  await expect(page.locator(".save-saved")).toBeVisible();
  expect(maximum).toBe(1); expect(new Set(versions).size).toBe(versions.length);
  expect(statuses.every((status) => status === 200)).toBe(true);
  await expect(page.getByText("检测到版本冲突", { exact: true })).toHaveCount(0);
  // Exercise the actual default interval, rather than a manual save.
  const countBefore = calls;
  await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" automatic ten seconds");
  await expect.poll(() => calls, { timeout: 16000 }).toBeGreaterThan(countBefore);
  await expect(page.locator(".save-saved")).toBeVisible();
  await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" unsaved before rename");
  await page.getByTitle("页面操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "重命名页面", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "重命名页面", exact: true });
  await rename.getByRole("textbox").fill("Renamed in this tab");
  await rename.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByLabel("页面标题", { exact: true })).toHaveValue("Renamed in this tab");
  await expect(editor).toContainText("unsaved before rename");
  await expect(page.getByText("检测到版本冲突", { exact: true })).toHaveCount(0);
  const beforeRemote = (await (await page.request.get(`/api/pages/${note.id}`)).json()).page;
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: beforeRemote.version, title: "Changed on another device" } })).ok()).toBeTruthy();
  await editor.click(); await page.keyboard.type(" local conflict draft"); await page.keyboard.press("Control+s");
  await expect(page.getByText("检测到版本冲突", { exact: true })).toBeVisible();
  const remote = (await (await page.request.get(`/api/pages/${note.id}`)).json()).page;
  expect(remote.title).toBe("Changed on another device");
  expect(remote.content).not.toContain("local conflict draft");
  await writeFile(testInfo.outputPath("save-coordination.json"), JSON.stringify({ maximum, versions, statuses, genuineConflictStatus: statuses.at(-1) }, null, 2));
});
