import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });
const formattedParagraph = (value: string) => ({ type: "paragraph", attrs: { textAlign: "right" }, content: [{ ...text(value), marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: "#2563EB" } }, { type: "highlight", attrs: { color: "#FEF08A" } }] }] });
const table = (rows: number, cols: number) => ({ type: "table", content: Array.from({ length: rows }, (_, r) => ({ type: "tableRow", content: Array.from({ length: cols }, (_, c) => ({ type: r ? "tableCell" : "tableHeader", content: [(r === 1 && c === 0 ? formattedParagraph : paragraph)(`中文 ${r}:${c} LongCellText`.repeat(c === 1 ? 8 : 1))] })) })) });

async function selectFirstParagraph(page: Page) {
  await page.locator(".notebook-editor > p").first().evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator(".bubble-menu")).toBeVisible();
}

test("Editor workspace, real fonts, search, print, trash and responsive layout", async ({ page, baseURL }, testInfo) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || !["3001", "3002"].includes(new URL(baseURL!).port)) throw new Error("Use a disposable test server on port 3001/3002 and E2E_ALLOW_MUTATIONS=1");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console.log(message.type(), message.text()); });
  const username = `v31_${Date.now()}`;
  const register = await page.request.post("/api/auth/register", { headers: { Origin: baseURL! }, data: { username, password: "BrowserTest12345", confirmPassword: "BrowserTest12345" } });
  expect(register.status()).toBe(201);
  const notebookResponse = await page.request.post("/api/notebooks", { headers: { Origin: baseURL! }, data: { title: "V3.1 浏览器测试" } });
  const { notebook } = await notebookResponse.json();
  const createPage = await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers: { Origin: baseURL! }, data: { title: "PDF 标题与表格验证 A long document title" } });
  const { page: note } = await createPage.json();
  const content = { type: "doc", content: [paragraph("字体测试 Cloud Notebook English 中文"), paragraph("Unselected text stays unchanged"), ...[1, 2, 3].map((level) => ({ type: "heading", attrs: { level }, content: [text(`Heading ${level}`)] })), table(2, 2), table(3, 5), paragraph("Search needle Search needle"), { type: "paragraph", content: [{ ...text("Legacy inline code"), marks: [{ type: "code" }] }] }] };
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers: { Origin: baseURL! }, data: { version: note.version, content } })).ok()).toBeTruthy();
  await page.goto("/app");
  await page.getByRole("button", { name: "V3.1 浏览器测试", exact: true }).click();
  await expect(page.locator(".notebook-editor")).toBeVisible();
  await page.getByTitle("页面操作", { exact: true }).click();
  await expect(page.getByRole("menuitem").nth(0)).toHaveText("置顶页面");
  await expect(page.getByRole("menuitem").nth(1)).toHaveText("重命名页面");
  await page.getByRole("menuitem", { name: "置顶页面", exact: true }).click();
  await expect(page.locator(".pinned-section")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pinned-section.png") });
  await page.getByTitle("页面操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "取消置顶", exact: true }).click();
  await expect(page.locator(".pinned-section")).toHaveCount(0);
  await page.getByRole("button", { name: "V3.1 浏览器测试 操作", exact: true }).click();
  await expect(page.getByRole("menuitem").nth(0)).toHaveText("置顶笔记本");
  await expect(page.getByRole("menuitem").nth(1)).toHaveText("重命名");
  await expect(page.getByRole("menuitem").nth(2)).toHaveText("编辑封面");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Markdown 源码", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("行内代码", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("代码块", { exact: true })).toBeVisible();
  for (const [level, size] of [[1, "30px"], [2, "24px"], [3, "20px"]] as const) await expect(page.locator(`.notebook-editor h${level}`)).toHaveCSS("font-size", size);
  for (const [value, tag, size] of [["h1", "h1", "30px"], ["h2", "h2", "24px"], ["h3", "h3", "20px"], ["p", "p", "16px"]]) {
    await page.locator(".notebook-editor").getByText("Unselected text stays unchanged", { exact: true }).click();
    await page.getByRole("combobox", { name: "标题样式", exact: true }).selectOption(value);
    await expect(page.locator(`.notebook-editor > ${tag}`).filter({ hasText: "Unselected text stays unchanged" })).toHaveCSS("font-size", size);
  }
  const fontReport: Record<string, unknown>[] = [];
  for (const id of ["noto-sans-sc", "noto-serif-sc", "inter", "merriweather", "zcool-xiaowei", "zcool-qingke-huangyou", "ma-shan-zheng", "roboto", "open-sans", "ibm-plex-mono", "merriweather"]) {
    await selectFirstParagraph(page);
    await page.getByRole("combobox", { name: "字体", exact: true }).selectOption(`var(--font-${id}), ${id.includes("serif") || id === "merriweather" || id === "zcool-xiaowei" ? "serif" : id === "ma-shan-zheng" ? "cursive" : id === "ibm-plex-mono" ? "monospace" : "sans-serif"}`);
    const span = page.locator(".notebook-editor > p").first().locator("span");
    await expect(span).toHaveAttribute("style", new RegExp(id));
    const result = await span.evaluate(async (element) => {
      const style = getComputedStyle(element);
      const primaryFamily = style.fontFamily.split(",")[0];
      await document.fonts.load(`${style.fontSize} ${primaryFamily}`, element.textContent!);
      await document.fonts.ready;
      const canvas = document.createElement("canvas"); const context = canvas.getContext("2d")!;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      return { family: style.fontFamily, loaded: document.fonts.check(`${style.fontSize} ${primaryFamily}`, element.textContent!), width: context.measureText(element.textContent!).width };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".notebook-editor > p span" });
    const rendered = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(result.loaded).toBe(true);
    expect(rendered.fonts.some((font) => font.isCustomFont && font.glyphCount > 0)).toBe(true);
    fontReport.push({ id, ...result, rendered: rendered.fonts });
    await cdp.detach();
    await expect(page.locator(".notebook-editor > p").nth(1).locator("span")).toHaveCount(0);
  }
  expect(fontReport[0].width).not.toBe(fontReport[1].width);
  expect(fontReport[2].width).not.toBe(fontReport[3].width);
  await writeFile(testInfo.outputPath("actual-fonts.json"), JSON.stringify(fontReport, null, 2));
  await testInfo.attach("actual-fonts", { body: JSON.stringify(fontReport, null, 2), contentType: "application/json" });
  await selectFirstParagraph(page);
  await page.getByRole("button", { name: "选中文字增大字号", exact: true }).click();
  await expect(page.locator(".notebook-editor > p").first().locator("span")).toHaveCSS("font-size", "18px");
  await page.getByRole("button", { name: "选中文字减小字号", exact: true }).click();
  await expect(page.locator(".notebook-editor > p").first().locator("span")).toHaveCSS("font-size", "16px");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".notebook-editor > p").first().locator("span")).toHaveCSS("font-size", "16px");
  const search = page.getByRole("button", { name: "搜索当前页面", exact: true });
  await search.click();
  const find = page.getByRole("searchbox", { name: "搜索当前页面正文" });
  await expect(find).toBeFocused();
  const triggerBox = await search.boundingBox(); const popoverBox = await find.boundingBox();
  expect(popoverBox!.y).toBeGreaterThan(triggerBox!.y);
  await find.fill("Search needle");
  await expect(page.locator(".page-find-match")).toHaveCount(2);
  await find.press("Enter"); await find.press("Shift+Enter");
  await search.click(); await expect(find).not.toBeVisible();
  await expect(page.locator(".page-find-match")).toHaveCount(0);
  await search.click(); await find.fill("Search");
  await page.getByLabel("清除搜索", { exact: true }).click(); await expect(find).toHaveValue("");
  await find.press("Escape"); await expect(find).not.toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.content).toContain("--font-merriweather");
  await page.reload(); await page.getByRole("button", { name: "V3.1 浏览器测试", exact: true }).click(); await expect(page.locator(".notebook-editor > p").first().locator("span")).toHaveCSS("font-family", /Merriweather/i);
  await page.screenshot({ path: testInfo.outputPath("workspace-1440.png"), fullPage: true });
  await page.getByRole("button", { name: "垃圾箱", exact: true }).click();
  await expect(page.locator(".editor-panel .trash-page")).toBeVisible();
  await expect(page.locator(".notebook-editor")).toHaveCount(0);
  await expect(page.locator('[role="dialog"][aria-labelledby="trash-title"]')).toHaveCount(0);
  await page.getByLabel("关闭垃圾箱").click(); await expect(page.locator(".notebook-editor")).toBeVisible();
  await page.getByTitle("编辑封面", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑封面" })).toBeVisible();
  await expect(page.locator("#notebook-edit-name")).toHaveCount(0);
  await expect(page.locator(".cover-file-button svg")).toHaveCount(0);
  const cover = page.getByRole("dialog", { name: "编辑封面" });
  await cover.locator('input[type="file"]').setInputFiles("tests/fixtures/cover.png");
  await page.getByRole("dialog", { name: "裁剪笔记本封面", exact: true }).getByRole("button", { name: "确认裁剪", exact: true }).click();
  await expect(cover.locator(".cover-dialog-preview img")).toBeVisible();
  await cover.getByRole("button", { name: "保存", exact: true }).click();
  await expect(cover).not.toBeVisible();
  await expect(page.locator(".notebook-cover-card img")).toBeVisible();
  await page.getByTitle("编辑封面", { exact: true }).click();
  await cover.locator('input[type="file"]').setInputFiles("tests/fixtures/cover.png");
  await page.getByRole("dialog", { name: "裁剪笔记本封面", exact: true }).getByRole("button", { name: "确认裁剪", exact: true }).click();
  await cover.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByTitle("编辑封面", { exact: true }).click();
  await cover.getByRole("button", { name: "移除封面", exact: true }).click();
  await expect(cover.getByRole("button", { name: "移除封面", exact: true })).toHaveCount(0);
  await cover.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByTitle("全局搜索 (Ctrl/Cmd+Shift+F)").click();
  await page.getByLabel("全局搜索词").fill("Search needle");
  await page.locator(".global-search-result").first().click();
  await expect(page.locator(".notebook-editor")).toContainText("Search needle");
  const deleted = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers: { Origin: baseURL! }, data: { title: "Trash regression" } })).json();
  await page.request.delete(`/api/pages/${deleted.page.id}`, { headers: { Origin: baseURL! } });
  await page.getByRole("button", { name: "垃圾箱", exact: true }).click();
  const trashRow = page.locator(".trash-item").filter({ hasText: "Trash regression" });
  await expect(trashRow).toContainText("天后永久删除");
  await trashRow.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(trashRow).toHaveCount(0);
  await page.request.delete(`/api/pages/${deleted.page.id}`, { headers: { Origin: baseURL! } });
  await page.getByLabel("关闭垃圾箱").click();
  await page.getByRole("button", { name: "垃圾箱", exact: true }).click();
  await trashRow.getByRole("button", { name: "永久删除Trash regression", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(trashRow).toHaveCount(0);
  await page.getByLabel("关闭垃圾箱").click();
  for (const width of [1920, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const label of ["搜索当前页面", "标题样式", "字体", "代码块"]) {
      const box = await page.getByLabel(label, { exact: true }).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await expect.poll(async () => page.locator(".title-input").evaluate((element) => element.clientHeight >= element.scrollHeight)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "隐藏工作区侧栏", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect.poll(async () => (await page.locator(".workspace > section.editor-panel").boundingBox())!.width).toBeGreaterThan(380);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  for (const route of [`/print/page/${note.id}`, `/print/notebook/${notebook.id}`]) {
    await page.goto(route);
    await expect(page.locator(".print-page-title")).toHaveCSS("font-size", "32px");
    await expect(page.locator("table")).toHaveCount(2);
    await expect(page.locator("td, th")).toHaveCount(19);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("table").first()).toHaveCSS("border-collapse", "collapse");
    await expect(page.locator("table mark").first()).toHaveCSS("background-color", "rgb(254, 240, 138)");
    await expect(page.locator("table span").first()).toHaveCSS("color", "rgb(37, 99, 235)");
    await page.pdf({ path: testInfo.outputPath(route.includes("notebook") ? "notebook.pdf" : "page.pdf"), format: "A4", printBackground: true });
    await page.screenshot({ path: testInfo.outputPath(route.includes("notebook") ? "print-notebook.png" : "print-page.png"), fullPage: true });
  }
  const latest = (await (await page.request.get(`/api/pages/${note.id}`)).json()).page;
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers: { Origin: baseURL! }, data: { version: latest.version, content: { type: "doc", content: [table(60, 5), paragraph("END_OF_LONG_TABLE")] } } })).ok()).toBeTruthy();
  await page.goto(`/print/page/${note.id}`);
  await expect(page.locator("table tr")).toHaveCount(60);
  await expect(page.getByText("END_OF_LONG_TABLE", { exact: true })).toBeVisible();
  await page.pdf({ path: testInfo.outputPath("long-table.pdf"), format: "A4", printBackground: true });
  const favicons = await page.locator('link[rel="icon"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  expect(favicons.length).toBeGreaterThan(0);
  for (const favicon of favicons) {
    expect(new URL(favicon).pathname).toBe("/icon.png");
    expect((await page.request.get(favicon)).ok()).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test("password visibility, disabled registration toast and shared favicon", async ({ page, browser, baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || !["3001", "3002"].includes(new URL(baseURL!).port)) throw new Error("Disposable test server required");
  await page.goto("/login");
  const password = page.locator('#password');
  await password.fill("Visibility12345");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!adminPassword, "Set E2E_ADMIN_PASSWORD for the disposable test admin to verify registration settings");
  const admin = await browser.newContext({ baseURL });
  try {
    let response = await admin.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: { username: "admin", password: adminPassword } });
    expect(response.ok()).toBeTruthy();
    if ((await response.json()).user.mustChangePassword) {
      expect((await admin.request.post("/api/auth/change-password", { headers: { Origin: baseURL! }, data: { password: adminPassword, confirmPassword: adminPassword } })).ok()).toBeTruthy();
      response = await admin.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: { username: "admin", password: adminPassword } });
      expect(response.ok()).toBeTruthy();
    }
    const adminPage = await admin.newPage();
    await adminPage.goto("/admin");
    const iconPaths = await adminPage.locator('link[rel="icon"]').evaluateAll((links) => links.map((link) => new URL((link as HTMLLinkElement).href).pathname));
    expect(iconPaths.length).toBeGreaterThan(0);
    expect(iconPaths.every((path) => path === "/icon.png")).toBe(true);
    expect((await admin.request.patch("/api/settings", { headers: { Origin: baseURL! }, data: { registrationEnabled: false } })).ok()).toBeTruthy();
    await page.reload();
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(page.getByText("请联系管理员开放注册入口", { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
  } finally {
    await admin.request.patch("/api/settings", { headers: { Origin: baseURL! }, data: { registrationEnabled: true } });
    await admin.close();
  }
});

test("image continuation, Markdown table editing, legacy code and font snapshot restore", async ({ page, baseURL }, testInfo) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || !["3001", "3002"].includes(new URL(baseURL!).port)) throw new Error("Disposable test server required");
  const headers = { Origin: baseURL! };
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `editor_${Date.now()}`, password: "BrowserTest12345", confirmPassword: "BrowserTest12345" } })).ok()).toBeTruthy();
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "Editor regression" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "Editor regression page" } })).json();
  await page.goto("/app"); await page.getByRole("button", { name: "Editor regression", exact: true }).click();
  const editor = page.locator(".notebook-editor");
  await editor.fill("Snapshot 字体测试");
  await selectFirstParagraph(page);
  await page.getByRole("combobox", { name: "字体", exact: true }).selectOption("var(--font-noto-serif-sc), serif");
  await page.keyboard.press("Control+s");
  // Await save, then force a snapshot of this formatted state through the existing API.
  await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.content).toContain("--font-noto-serif-sc");
  const saved = (await (await page.request.get(`/api/pages/${note.id}`)).json()).page;
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: saved.version, title: "Temporary title", preserveCurrentVersion: true } })).ok()).toBeTruthy();
  await page.reload(); await page.getByRole("button", { name: "Editor regression", exact: true }).click();
  await page.getByTitle("版本历史").click();
  await page.locator(".history-item").first().getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "恢复版本", exact: true }).click();
  await expect(editor.locator("span")).toHaveAttribute("style", /noto-serif-sc/);
  await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.press("Enter");
  await page.locator('label[aria-label="插入图片"] input').setInputFiles("tests/fixtures/cover.png");
  await expect(editor.locator("img")).toHaveCount(1);
  await page.keyboard.type("Typed after image");
  await expect(editor).toContainText("Typed after image");
  await page.keyboard.press("Enter");
  await editor.evaluate((element) => {
    const data = new DataTransfer(); data.setData("text/plain", "| 中文列 | 状态 |\n| --- | --- |\n| **粗体** | 完成 |\n| 第二行 | 保留 |");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator("th")).toHaveCount(2);
  await expect(editor.locator("strong")).toHaveText("粗体");
  await editor.locator("td").first().click();
  await page.getByRole("button", { name: "上方插入行", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(4);
  await editor.locator("tr").nth(1).locator("td").first().click();
  await page.getByRole("button", { name: "删除行", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(3);
  await editor.click(); await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await page.keyboard.type("`new inline code`");
  await expect(editor.locator("code")).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.content).toContain("new inline code");
  await page.goto(`/print/page/${note.id}`);
  await expect(page.locator("table th")).toHaveCount(2);
  await expect(page.locator("table strong")).toHaveText("粗体");
  await page.pdf({ path: testInfo.outputPath("markdown-table.pdf"), format: "A4", printBackground: true });
});
