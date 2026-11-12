import { test, expect, type Page } from "@playwright/test";

const presets = { compact: [12, 12, 14, 18, 22], standard: [12, 14, 16, 20, 24], large: [14, 16, 18, 22, 26] } as const;
const labels = { compact: "紧凑", standard: "标准", large: "大号" } as const;
type Preset = keyof typeof presets;

async function chooseSize(page: Page, preset: Preset) {
  const settings = page.getByRole("button", { name: "账号与设置", exact: true });
  if (await page.getByLabel("显示文件夹", { exact: true }).isVisible() && !(await page.locator(".workspace").getAttribute("class"))?.includes("show-sidebar")) await page.getByLabel("显示文件夹", { exact: true }).click();
  await settings.click();
  await page.getByRole("menuitem", { name: "界面字号", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: labels[preset], exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", preset);
  if (await page.getByLabel("关闭导航", { exact: true }).isVisible()) await page.getByLabel("关闭导航", { exact: true }).click();
}

async function chooseTheme(page: Page, label: "深色" | "浅色") {
  await page.getByRole("button", { name: "账号与设置", exact: true }).click();
  await page.getByRole("menuitem", { name: "外观", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

async function seed(page: Page, baseURL: string) {
  const headers = { Origin: baseURL };
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `type_${Date.now()}`, password: "BrowserTest12345", confirmPassword: "BrowserTest12345" } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "界面字体测试" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "Document title stays independent" } })).json();
  const content = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Small 8px", marks: [{ type: "textStyle", attrs: { fontSize: "8px", fontFamily: "var(--font-merriweather), serif" } }] }] },
    { type: "paragraph", content: [{ type: "text", text: "Large 96px", marks: [{ type: "textStyle", attrs: { fontSize: "96px" } }] }] },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Heading stays 30px" }] },
    ...Array.from({ length: 30 }, (_, index) => ({ type: "paragraph", content: [{ type: "text", text: `Default 16px paragraph ${index}` }] }))
  ] };
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: note.version, content } })).ok()).toBeTruthy();
  await page.goto(`/app?page=${note.id}`);
  await expect(page.locator(".notebook-editor")).toBeVisible();
  return note;
}

test.beforeEach(async ({ baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
});

test("all UI presets persist and scale portals, controls and navigation without changing documents or print", async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const note = await seed(page, baseURL!);
  const before = (await (await page.request.get(`/api/pages/${note.id}`)).json()).page;
  const titleSize = await page.getByLabel("页面标题", { exact: true }).evaluate((element) => getComputedStyle(element).fontSize);
  for (const preset of ["compact", "standard", "large"] as const) {
    await chooseSize(page, preset);
    const [caption, secondary, body, heading, title] = presets[preset];
    await expect(page.locator(".page-row-time")).toHaveCSS("font-size", `${caption}px`);
    await expect(page.locator(".notebook-name")).toHaveCSS("font-size", `${secondary}px`);
    await expect(page.locator(".page-row-title")).toHaveCSS("font-size", `${body}px`);
    await expect(page.locator(".pages-panel-heading > span")).toHaveCSS("font-size", `${body}px`);
    await expect(page.locator(".toolbar-row select").first()).toHaveCSS("font-size", `${secondary}px`);
    await expect(page.locator(".notebook-editor")).toHaveCSS("font-size", "16px");
    await expect(page.locator('.notebook-editor span[style*="8px"]')).toHaveCSS("font-size", "8px");
    await expect(page.locator('.notebook-editor span[style*="96px"]')).toHaveCSS("font-size", "96px");
    await expect(page.locator(".notebook-editor h1")).toHaveCSS("font-size", "30px");
    await expect(page.getByLabel("页面标题", { exact: true })).toHaveCSS("font-size", titleSize);
    await page.getByTitle("编辑封面", { exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑封面", exact: true });
    await expect(dialog.locator("h2")).toHaveCSS("font-size", `${heading}px`);
    await expect(dialog.getByRole("button", { name: "上传封面", exact: true })).toHaveCSS("font-size", `${secondary}px`);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "账号与设置", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "界面字号", exact: true })).toHaveCSS("font-size", `${secondary}px`);
    await page.getByRole("menuitem", { name: "界面字号", exact: true }).hover();
    await expect(page.getByRole("menuitemradio", { name: labels[preset], exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    const stored = (await (await page.request.get("/api/settings")).json()).settings;
    expect(stored.uiFontSize).toBe(preset);
    const html = await (await page.request.get(`/app?page=${note.id}`)).text();
    expect(html).toContain(`data-ui-font-size="${preset}"`);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", preset);
    await expect(page.locator(".notebook-editor")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${preset}-light.png`) });
    await chooseTheme(page, "深色");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator(".page-row-title")).toHaveCSS("font-size", `${body}px`);
    await page.screenshot({ path: testInfo.outputPath(`${preset}-dark.png`) });
    await chooseTheme(page, "浅色");
    // Tailwind utility and CSS role selectors resolve to the same variables.
    const sizes = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "text-ui-title"; document.body.appendChild(probe);
      const result = getComputedStyle(probe).fontSize; probe.remove(); return result;
    });
    expect(sizes).toBe(`${title}px`);
  }
  const after = (await (await page.request.get(`/api/pages/${note.id}`)).json()).page;
  expect(after.content).toBe(before.content);
  expect(after.version).toBe(before.version);

  const printPage = await page.context().newPage();
  await printPage.goto(`/print/page/${note.id}`);
  for (const media of ["screen", "print"] as const) {
    await printPage.emulateMedia({ media });
    await expect(printPage.locator(".prose-print")).toHaveCSS("font-size", "16px");
    await expect(printPage.locator('article span[style*="8px"]')).toHaveCSS("font-size", "8px");
    await expect(printPage.locator('article span[style*="96px"]')).toHaveCSS("font-size", "96px");
    await expect(printPage.locator("article h1")).toHaveCSS("font-size", "30px");
  }
  await printPage.pdf({ path: testInfo.outputPath("large-ui-document.pdf"), format: "A4", printBackground: true });
  await printPage.close();
  expect(errors).toEqual([]);
});

test("all presets remain usable on desktop, tablet and mobile with transient UI", async ({ page, baseURL }, testInfo) => {
  await seed(page, baseURL!);
  for (const preset of ["compact", "standard", "large"] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await chooseSize(page, preset);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".notebook-editor")).toBeVisible();
      for (const selector of [".editor-topbar-navigation-row", ".toolbar-wrapper"]) {
        expect(await page.locator(selector).evaluate((element) => element.scrollWidth <= element.clientWidth), selector).toBe(true);
      }
      await page.getByRole("button", { name: "搜索当前页面", exact: true }).click();
      const search = page.getByLabel("搜索当前页面正文", { exact: true });
      await search.fill("Default");
      await expect(search).toHaveCSS("font-size", `${presets[preset][1]}px`);
      const popover = (await page.locator(".page-find-bar").boundingBox())!;
      expect(popover.x).toBeGreaterThanOrEqual(0); expect(popover.x + popover.width).toBeLessThanOrEqual(width + 1);
      await page.getByLabel("关闭搜索", { exact: true }).click();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("cloud-notebook:notification", { detail: { type: "info", message: "界面字号提示", id: "typography", duration: 60000 } })));
      await expect(page.locator(".app-toast > span")).toHaveCSS("font-size", `${presets[preset][1]}px`);
      await page.screenshot({ path: testInfo.outputPath(`${preset}-${width}.png`) });
      await page.getByLabel("关闭通知", { exact: true }).click();
    }
  }
});

test("failed preference writes keep the active size, and invalid input is rejected", async ({ page, baseURL }) => {
  await seed(page, baseURL!);
  expect((await page.request.patch("/api/settings/typography", { headers: { Origin: baseURL! }, data: { uiFontSize: "huge" } })).status()).toBe(400);
  expect((await page.request.patch("/api/settings/typography", { headers: { Origin: "https://invalid.example" }, data: { uiFontSize: "large" } })).status()).toBe(403);
  await page.route("**/api/settings/typography", (route) => route.fulfill({ status: 500, json: { error: "设置保存失败" } }));
  await page.getByRole("button", { name: "账号与设置", exact: true }).click();
  await page.getByRole("menuitem", { name: "界面字号", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: "大号", exact: true }).click();
  await expect(page.getByText("设置保存失败", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "standard");
  expect((await (await page.request.get("/api/settings")).json()).settings.uiFontSize).toBe("standard");
});

test("admin preference persists, anonymous pages restore the cookie, and new accounts keep their own default", async ({ page, baseURL }) => {
  const headers = { Origin: baseURL! };
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) throw new Error("Disposable E2E_ADMIN_PASSWORD required");
  let login = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password } });
  expect(login.ok()).toBeTruthy();
  if ((await login.json()).user.mustChangePassword) {
    expect((await page.request.post("/api/auth/change-password", { headers, data: { password, confirmPassword: password } })).ok()).toBeTruthy();
    login = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password } });
    expect(login.ok()).toBeTruthy();
  }
  await page.goto("/admin/settings");
  const input = page.getByRole("combobox", { name: "界面字号", exact: true });
  for (const preset of ["compact", "standard", "large"] as const) {
    await input.selectOption(preset);
    await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", preset);
    await expect(page.locator(".admin-title")).toHaveCSS("font-size", `${presets[preset][4]}px`);
    await expect(input).toHaveCSS("font-size", `${presets[preset][1]}px`);
    await page.reload();
    await expect(input).toHaveValue(preset);
  }
  // The browser cookie follows this device; the account preference is separate.
  expect((await page.request.post("/api/auth/logout", { headers })).ok()).toBeTruthy();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "large");
  await expect(page.locator(".auth-brand")).toHaveCSS("font-size", "26px");
  await expect(page.locator(".field-label").first()).toHaveCSS("font-size", "16px");
  const html = await (await page.request.get("/login")).text();
  expect(html).toContain('data-ui-font-size="large"');
  expect((await page.request.patch("/api/settings/typography", { headers, data: { uiFontSize: "compact" } })).status()).toBe(401);
  await seed(page, baseURL!);
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "standard");
});
