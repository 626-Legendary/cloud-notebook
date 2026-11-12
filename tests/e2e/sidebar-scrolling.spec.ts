import { test, expect } from "@playwright/test";

test("sidebar labels align and long lists reveal scrollbars and fade only hidden edges", async ({ page, baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const headers = { Origin: baseURL };
  const password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `scroll_${Date.now()}`, password, confirmPassword: password } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "Scrolling notebook" } })).json();
  let noteId = "";
  const pinIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    expect((await page.request.post("/api/folders", { headers, data: { name: `Folder ${i}` } })).ok()).toBeTruthy();
    const response = await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: `Page ${i}` } });
    expect(response.ok()).toBeTruthy();
    noteId = (await response.json()).page.id;
    if (i < 10) pinIds.push(noteId);
  }
  for (const id of pinIds) expect((await page.request.post("/api/pins", { headers, data: { type: "page", id } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`/app?page=${noteId}`);
  await expect(page.locator(".notebook-editor")).toBeVisible();
  await expect(page.locator(".sidebar-trash-button")).toHaveCSS("font-size", "12px");
  await expect(page.locator(".workspace-section-label")).toHaveCSS("font-size", "12px");
  for (const selector of [".pinned-section", ".folder-tree", ".pages-panel-scroll"]) {
    const area = page.locator(selector);
    await page.mouse.move(1200, 10);
    await page.locator(".sidebar-trash-button").focus();
    await area.evaluate((element) => { element.scrollTop = 0; });
    await expect(area).toHaveAttribute("data-fade-top", "false");
    await expect(area).toHaveAttribute("data-fade-bottom", "true");
    const width = await area.evaluate((element) => element.clientWidth);
    await area.evaluate((element) => { element.scrollTop = 50; });
    await expect(area).toHaveAttribute("data-scrolling", "true");
    await expect(area).toHaveAttribute("data-fade-top", "true");
    await expect(area).toHaveAttribute("data-scrolling", "false");
    expect(await area.evaluate((element) => getComputedStyle(element).scrollbarColor)).toBe("rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
    expect(await area.evaluate((element) => element.clientWidth)).toBe(width);
    await expect(area).toHaveAttribute("data-scrollbar-visible", "false");
    await area.hover();
    await expect(area).toHaveAttribute("data-scrollbar-visible", "true");
    expect(await area.evaluate((element) => getComputedStyle(element).scrollbarColor)).not.toBe("rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
    const position = await area.evaluate((element) => element.scrollTop);
    // Moving away and back reveals the same position without a new scroll.
    await page.mouse.move(1200, 10);
    await expect(area).toHaveAttribute("data-scrollbar-visible", "false");
    await area.hover();
    await expect(area).toHaveAttribute("data-scrollbar-visible", "true");
    expect(await area.evaluate((element) => element.scrollTop)).toBe(position);
    await area.focus();
    await page.mouse.move(1200, 10);
    await expect(area).toHaveAttribute("data-scrollbar-visible", "true");
    await page.keyboard.press("End");
    await expect.poll(() => area.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
    await expect(area).toHaveAttribute("data-fade-bottom", "false");
    await expect(area).toHaveAttribute("data-scrolling", "false");
    await expect(area).toHaveAttribute("data-scrollbar-visible", "true");
    await page.locator(".sidebar-trash-button").focus();
    await expect(area).toHaveAttribute("data-scrollbar-visible", "false");
    // Touch reveals immediately, including before any scrolling; cancellation releases it.
    await area.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 9 });
    await expect(area).toHaveAttribute("data-scrollbar-visible", "true");
    await area.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 9 });
    await expect(area).toHaveAttribute("data-scrollbar-visible", "false");
  }
});
