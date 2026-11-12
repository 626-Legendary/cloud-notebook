import { test, expect, type Page } from "@playwright/test";
const password = "BrowserTest12345";
async function seed(page: Page, baseURL: string) {
  const headers = { Origin: baseURL };
  const username = `ui_${Date.now()}`;
  expect((await page.request.post("/api/auth/register", { headers, data: { username, password, confirmPassword: password } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "UI regression" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "UI regression note" } })).json();
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: note.version, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Link target and search needle", marks: [{ type: "textStyle", attrs: { color: "#123456", fontSize: "16px" } }] }] }] } } })).ok()).toBeTruthy();
  await page.goto(`/app?page=${note.id}`); await expect(page.locator(".notebook-editor")).toBeVisible();
  return { note, username, headers };
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "账号与设置", exact: true }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
}
async function appearance(page: Page, label: string) {
  await page.getByRole("button", { name: "账号与设置", exact: true }).click();
  await page.getByRole("menuitem", { name: "外观", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const channels = hex.trim().slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
test.beforeEach(async ({ baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
});

test("exact keyboard shortcuts, readable dark UI, toolbar grouping and mobile navigation", async ({ page, baseURL }, testInfo) => {
  await seed(page, baseURL!);
  const editor = page.locator(".notebook-editor");
  await editor.click(); await page.keyboard.press("Control+Shift+f");
  await expect(page.getByRole("dialog", { name: "全局搜索", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "插入链接", exact: true })).toHaveCount(0);
  await page.getByLabel("关闭搜索", { exact: true }).click();
  await editor.click(); await page.keyboard.press("Control+f");
  await expect(page.getByLabel("搜索当前页面正文", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await editor.locator("p").first().evaluate((element) => {
    (element.parentElement as HTMLElement).focus();
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press("Control+k");
  const link = page.getByRole("dialog", { name: "插入链接", exact: true });
  await expect(link).toBeVisible();
  await page.keyboard.press("Control+Shift+f");
  await expect(page.getByRole("dialog", { name: "全局搜索", exact: true })).toHaveCount(0);
  await link.getByLabel("链接地址", { exact: true }).fill("https://example.com");
  await link.getByRole("button", { name: "应用链接", exact: true }).click();
  await expect(editor.locator('a[href="https://example.com"]')).toBeVisible();
  await page.getByTitle("全局搜索 (Ctrl/Cmd+Shift+F)", { exact: true }).click();
  await page.getByLabel("全局搜索词", { exact: true }).fill("needle");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "插入链接", exact: true })).toHaveCount(0);
  await page.getByLabel("关闭搜索", { exact: true }).click();
  const paragraph = page.getByRole("combobox", { name: "标题样式", exact: true });
  expect(await paragraph.evaluate((element) => element.nextElementSibling?.classList.contains("toolbar-divider"))).toBe(true);
  expect(await page.locator(".font-size-controls").evaluate((element) => element.nextElementSibling?.classList.contains("toolbar-divider"))).toBe(true);
  expect(await page.getByLabel("自定义字号", { exact: true }).evaluate((element) => element.nextElementSibling?.classList.contains("toolbar-divider"))).toBe(true);
  await expect(page.locator(".font-size-step-button").first()).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".pages-panel-heading > span")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".pages-panel-heading")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.locator(".pages-panel-divider")).toHaveCSS("height", "1px");
  await appearance(page, "深色");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const values = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(["--ui-text-muted", "--ui-text-secondary", "--sidebar-surface", "--pages-surface", "--paper-surface"].map((key) => [key, css.getPropertyValue(key)]));
  });
  for (const color of ["--ui-text-muted", "--ui-text-secondary"]) for (const surface of ["--sidebar-surface", "--pages-surface", "--paper-surface"]) expect(contrast(values[color], values[surface])).toBeGreaterThanOrEqual(4.5);
  await expect(editor.locator('span[style*="color"]').first()).toHaveCSS("color", "rgb(18, 52, 86)");
  await page.screenshot({ path: testInfo.outputPath("dark-desktop.png") });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = (await page.locator(".editor-navigation").boundingBox())!, actions = (await page.locator(".editor-actions").boundingBox())!;
    expect(actions.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
    expect(await page.locator(".editor-topbar").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.locator(".header-action-label").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`dark-mobile-${width}.png`) });
  }
});

test("logout waits visibly, flushes edits, revokes the old cookie and stays signed out after reload", async ({ page, browser, baseURL }) => {
  const { note, username, headers } = await seed(page, baseURL!);
  const oldCookies = await page.context().cookies();
  await page.getByLabel("页面标题", { exact: true }).fill("Saved before logout");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/auth/logout", async (route) => { requests++; const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  await logout(page);
  await expect(page.locator(".logout-progress")).toBeVisible();
  await expect(page.locator(".logout-progress")).toBeFocused();
  await page.keyboard.type("should not edit the note");
  expect(requests).toBe(1);
  release();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload(); await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  const stale = await browser.newContext({ baseURL });
  try { await stale.addCookies(oldCookies); expect((await stale.request.get("/api/auth/me")).status()).toBe(401); }
  finally { await stale.close(); }
  expect((await page.request.post("/api/auth/login", { headers, data: { username, password } })).ok()).toBeTruthy();
  const saved = (await (await page.request.get(`/api/pages/${note.id}`)).json()).page;
  expect(saved.title).toBe("Saved before logout");
  expect(saved.content).not.toContain("should not edit");
});

test("failed logout is visible and retry succeeds without fake navigation", async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 503, json: { error: "服务器暂时无法完成退出，请重试" } }));
  await logout(page);
  await expect(page.getByText("服务器暂时无法完成退出，请重试", { exact: true })).toBeVisible();
  await expect(page.locator(".logout-progress")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/app");
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
  await page.unroute("**/api/auth/logout");
  await logout(page); await expect(page).toHaveURL(/\/login$/);
});

test("logout retains the session and local draft when saving has a conflict", async ({ page, baseURL }) => {
  const { note } = await seed(page, baseURL!);
  let logoutRequests = 0;
  await page.route("**/api/auth/logout", (route) => { logoutRequests++; return route.continue(); });
  await page.route(`**/api/pages/${note.id}`, (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 409, json: { error: "页面存在版本冲突", currentVersion: 99 } }) : route.continue());
  await page.getByLabel("页面标题", { exact: true }).fill("Local unsaved title");
  await logout(page);
  await expect(page.getByText("请先保存或解决当前页面的版本冲突", { exact: true })).toBeVisible();
  await expect(page.locator(".logout-progress")).toHaveCount(0);
  expect(logoutRequests).toBe(0);
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
  expect(await page.evaluate((id) => localStorage.getItem(`cloud-notebook-draft:${id}`), note.id)).toContain("Local unsaved title");
});

test("system setting sections have equal spacing and administrator logout uses the same confirmed flow", async ({ page, baseURL }) => {
  const headers = { Origin: baseURL! }, pwd = process.env.E2E_ADMIN_PASSWORD;
  if (!pwd) throw new Error("Disposable admin password required");
  let response = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password: pwd } });
  expect(response.ok()).toBeTruthy();
  if ((await response.json()).user.mustChangePassword) {
    expect((await page.request.post("/api/auth/change-password", { headers, data: { password: pwd, confirmPassword: pwd } })).ok()).toBeTruthy();
    response = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password: pwd } }); expect(response.ok()).toBeTruthy();
  }
  await page.goto("/admin/settings");
  const sections = await page.locator(".admin-settings-sections > .admin-section").all();
  expect(sections).toHaveLength(3);
  for (let i = 1; i < sections.length; i++) {
    const previous = (await sections[i - 1].boundingBox())!, current = (await sections[i].boundingBox())!;
    expect(Math.abs(current.y - previous.y - previous.height - 20)).toBeLessThan(1);
  }
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload(); expect((await page.request.get("/api/auth/me")).status()).toBe(401);
});
