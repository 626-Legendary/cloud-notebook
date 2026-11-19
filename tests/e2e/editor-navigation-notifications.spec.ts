import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("Favicon, shared theme controls, preferences-only app theme, search icons and editor notifications", async ({ page, baseURL }, testInfo) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  const theme = page.locator(".auth-theme .theme-toggle");
  await expect(theme).toBeVisible();
  await expect(page.locator(".auth-theme.theme-chip")).toHaveCount(0);
  for (const name of ["深色", "浅色", "跟随系统"]) {
    await theme.getByRole("button", { name, exact: true }).click();
    await expect(theme.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator('link[rel="icon"][href^="/icon.png"]').first()).toHaveAttribute("href", /\/icon.png/);
  const favicon = await page.request.get("/icon.png");
  expect(favicon.ok()).toBeTruthy();
  expect(await favicon.body()).toEqual(await readFile("src/app/icon.png"));
  const headers = { Origin: baseURL! };
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `v1026_${Date.now()}`, password: "BrowserTest12345", confirmPassword: "BrowserTest12345" } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "1026 布局测试" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "布局与通知" } })).json();
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: note.version, content: { type: "doc", content: Array.from({ length: 80 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `search needle ${i}` }] })) } } })).ok()).toBeTruthy();
  await page.goto(`/app?page=${note.id}`);
  await expect(page.locator(".notebook-editor")).toBeVisible();
  await expect(page.getByLabel("应用版本")).toHaveText("v 1.1.1119");
  await page.getByRole("button", { name: "搜索当前页面", exact: true }).click();
  const input = page.getByRole("searchbox", { name: "搜索当前页面正文", exact: true });
  await input.fill("needle");
  await expect(page.getByLabel("清除搜索", { exact: true }).locator("svg.lucide-eraser")).toHaveCount(1);
  await expect(page.getByLabel("关闭搜索", { exact: true }).locator("svg.lucide-x")).toHaveCount(1);
  await page.getByLabel("清除搜索", { exact: true }).click();
  await expect(input).toHaveValue(""); await expect(input).toBeFocused();
  await page.getByLabel("关闭搜索", { exact: true }).click();
  await expect(input).not.toBeVisible();

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".editor-topbar-theme-row")).toHaveCount(0);
    const bottom = page.locator(".editor-topbar-navigation-row");
    await expect(page.locator(".editor-panel .theme-toggle")).toHaveCount(0);
    await expect(bottom.locator(".breadcrumbs")).toBeVisible();
    await expect(bottom.locator(".theme-toggle")).toHaveCount(0);
    const crumbs = (await bottom.locator(".breadcrumbs").boundingBox())!;
    const actions = (await bottom.locator(".editor-actions").boundingBox())!;
    if (width <= 600) expect(actions.y).toBeGreaterThanOrEqual(crumbs.y + crumbs.height - 1);
    else expect(actions.x).toBeGreaterThanOrEqual(crumbs.x + crumbs.width - 1);
    expect(await bottom.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.evaluate((w) => window.dispatchEvent(new CustomEvent("cloud-notebook:notification", { detail: { id: `layout-${w}`, type: "success", message: "通知定位验证", duration: 60000 } })), width);
    const viewport = page.locator(".editor-scroll .toast-viewport");
    await expect(viewport.getByText("通知定位验证")).toBeVisible();
    for (const scrollTop of [0, 600]) {
      await page.locator(".editor-scroll").evaluate((element, offset) => { element.scrollTop = offset; }, scrollTop);
      await expect.poll(async () => {
        const scroll = (await page.locator(".editor-scroll").boundingBox())!;
        const toast = (await viewport.boundingBox())!;
        return Math.abs(toast.x + toast.width / 2 - scroll.x - scroll.width / 2);
      }).toBeLessThan(2);
      const scroll = (await page.locator(".editor-scroll").boundingBox())!, toast = (await viewport.boundingBox())!;
      expect(Math.abs(toast.y - scroll.y - 16)).toBeLessThan(2);
    }
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`) });
    await viewport.getByRole("button", { name: "关闭通知", exact: true }).click();
  }
  await page.getByLabel("显示文件夹", { exact: true }).click();
  await page.getByRole("button", { name: "垃圾箱", exact: true }).click();
  await expect(page.locator(".editor-scroll")).toHaveCount(0);
  await expect(page.locator(".toast-viewport")).toHaveCount(1);
  await expect(page.locator(".toast-viewport")).toHaveCSS("position", "fixed");
  await page.goto("/app");
  await expect(page.locator(".editor-empty-topbar")).toBeVisible();
  await expect(page.locator(".workspace .theme-toggle")).toHaveCount(0);
  await expect(page.getByLabel("显示文件夹", { exact: true })).toBeVisible();
  await expect(page.getByLabel("显示页面列表", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "我的笔记本", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入笔记本 (.cnf)", exact: true })).toBeVisible();
  await expect(page.locator(".pages-panel")).toHaveCount(0);
  expect(errors).toEqual([]);
});
