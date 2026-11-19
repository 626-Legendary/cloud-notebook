import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, baseURL: string) {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const headers = { Origin: baseURL }, password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `library_ui_${Date.now()}`, password, confirmPassword: password } })).status()).toBe(201);
  const entries: { id: string; title: string }[] = [];
  for (let index = 0; index < 14; index++) {
    const title = (`词条 ${index} · ` + "长名称与知识界面布局".repeat(12)).slice(0, 115);
    const response = await page.request.post("/api/knowledge", { headers, data: {
      title, aliases: Array.from({ length: 6 }, (_, alias) => (`Alias ${index}-${alias} ` + "long-alias ".repeat(12)).slice(0, 115)),
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "这是一篇用于检查长摘要与界面排版的知识文章。".repeat(100) }] }] }
    } });
    expect(response.status()).toBe(201); entries.push((await response.json()).entry);
  }
  return { headers, entries };
}

async function expectNoHorizontalScroll(page: Page, selector: string) {
  expect(await page.locator(selector).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("library fits long content at all UI sizes and desktop/tablet/mobile widths", async ({ page, baseURL }, testInfo) => {
  const { headers } = await seed(page, baseURL!);
  await page.goto("/app/library");
  for (const preset of ["compact", "standard", "large"]) {
    expect((await page.request.patch("/api/settings/typography", { headers, data: { uiFontSize: preset } })).ok()).toBe(true);
    await page.reload(); await expect(page.locator(".knowledge-entry-row")).toHaveCount(14);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalScroll(page, ".knowledge-library");
      await expectNoHorizontalScroll(page, ".knowledge-entry-list");
      expect(await page.locator(".knowledge-entry-row").evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth + 1))).toBe(true);
      await expect(page.locator(".knowledge-entry-main strong").first()).toHaveCSS("text-overflow", "ellipsis");
      const typography = await page.locator(".knowledge-entry-main strong").first().evaluate((element) => ({ actual: getComputedStyle(element).fontSize, token: getComputedStyle(document.documentElement).getPropertyValue("--ui-body").trim() }));
      expect(typography.actual).toBe(typography.token);
      expect(await page.locator(".knowledge-entry-list").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      if (preset === "standard" && [1440, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`) });
    }
  }
  await expect(page.locator(".knowledge-import svg")).toHaveClass(/lucide-database-arrow-down/);
  await expect(page.getByRole("button", { name: "导出知识库", exact: true }).locator("svg")).toHaveClass(/lucide-database-arrow-up/);
});

test("mention menu, truncated preview and reference repair remain readable without horizontal overflow", async ({ page, baseURL }, testInfo) => {
  const { headers, entries } = await seed(page, baseURL!);
  expect((await page.request.patch("/api/settings/typography", { headers, data: { uiFontSize: "large" } })).ok()).toBe(true);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "界面检查" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "保持文档字号" } })).json();
  const ref = (entryId: string, label: string) => ({ type: "knowledgeReference", attrs: { entryId, label, referenceType: "entry" } });
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: 1, content: { type: "doc", content: [{ type: "paragraph", content: [ref(entries[0].id, entries[0].title), { type: "text", text: " " }, ref(crypto.randomUUID(), "失效目标与长引用文字".repeat(12))] }] } } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(`/app?page=${note.id}`);
  const editor = page.locator(".notebook-editor"); await expect(editor).toBeVisible(); await expect(editor).toHaveCSS("font-size", "16px");
  await editor.press("Control+End"); await editor.pressSequentially(" @"); const menu = page.getByRole("listbox", { name: "知识库词条联想" }); await expect(menu).toBeVisible();
  const paint = await menu.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, opacity: getComputedStyle(element).opacity }));
  expect(paint.background).toMatch(/(?:,|\/)\s*0\.9\s*\)/); expect(paint.opacity).toBe("1");
  await expect(menu.locator(".knowledge-suggestion-text > span").first()).toHaveCSS("white-space", "nowrap");
  for (let index = 0; index < 7; index++) await editor.press("ArrowDown");
  expect(await menu.locator(".knowledge-suggestion-items").evaluate((element) => element.scrollTop > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mention-menu.png") });
  const lightText = await menu.evaluate((element) => getComputedStyle(element).color);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  expect(await menu.evaluate((element) => getComputedStyle(element).color)).not.toBe(lightText);
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/(?:,|\/)\s*0\.9\s*\)/);
  await page.screenshot({ path: testInfo.outputPath("mention-menu-dark.png") }); await page.evaluate(() => document.documentElement.classList.remove("dark")); await editor.press("Escape");
  await editor.locator(`[data-entry-id="${entries[0].id}"]`).click(); const preview = page.locator(".knowledge-preview"); await expect(preview).toBeVisible();
  await expect(preview.locator(".knowledge-preview-summary")).toHaveCSS("-webkit-line-clamp", "3");
  expect(await preview.locator(".knowledge-preview-summary").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(preview.locator(".knowledge-preview-actions")).toHaveCSS("border-top-width", "1px");
  await page.screenshot({ path: testInfo.outputPath("entry-preview.png") }); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "账号与设置", exact: true }).click(); await page.getByRole("menuitem", { name: "数据管理", exact: true }).hover(); await page.getByRole("menuitem", { name: "引用检查", exact: true }).click();
  const check = page.locator(".knowledge-check-dialog"); await expect(check).toBeVisible(); await check.getByRole("button", { name: "开始检查", exact: true }).click(); await expect(check.locator(".knowledge-check-issue")).toHaveCount(1);
  await check.getByRole("button", { name: "修复此处引用", exact: true }).click(); await expect(check.getByRole("complementary", { name: "修复引用", exact: true })).toBeVisible();
  await expect(check.locator(".knowledge-repair-context strong")).toHaveCSS("-webkit-line-clamp", "3");
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await expectNoHorizontalScroll(page, ".knowledge-check-dialog"); await expectNoHorizontalScroll(page, ".knowledge-check-scroll");
    if ([1280, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`reference-check-${width}.png`) });
  }
  await check.getByLabel("取消修复", { exact: true }).click(); await expect(check.locator(".knowledge-repair")).toHaveCount(0);
});
