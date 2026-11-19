import { test, expect, type Page } from "@playwright/test";
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const reference = (id: string, label: string) => ({ type: "knowledgeReference", attrs: { entryId: id, label, referenceType: "entry" } });
async function setup(page: Page, baseURL: string) {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const headers = { Origin: baseURL }, password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `knowledge_${Date.now()}`, password, confirmPassword: password } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "知识关联笔记本" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "引用来源页面" } })).json();
  const aResponse = await page.request.post("/api/knowledge", { headers, data: { title: "操作系统", aliases: ["OS", "Operating System"], content: doc("知识定义 "+"长内容。".repeat(300)+"末尾全文检索") } }); expect(aResponse.status()).toBe(201); const { entry: a } = await aResponse.json();
  const { entry: b } = await (await page.request.post("/api/knowledge", { headers, data: { title: "虚拟内存", content: { type: "doc", content: [{ type: "paragraph", content: [reference(a.id, a.title)] }] } } })).json();
  await page.request.patch(`/api/knowledge/${a.id}`, { headers, data: { version: 1, content: { type: "doc", content: [{ type: "paragraph", content: [reference(b.id, b.title)] }, ...doc("知识定义 "+"长内容。".repeat(300)+"末尾全文检索").content] } } });
  return { headers, note, notebook, a, b };
}
test("knowledge previews, shared editor, aliases, cycle navigation, backlinks and full-text search", async ({ page, baseURL }, testInfo) => {
  const { headers, note, a, b } = await setup(page, baseURL!);
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: 1, content: { type: "doc", content: [{ type: "paragraph", content: [reference(a.id,a.title), { type: "text", text: " 和 " }, reference(a.id,a.title)] }] } } })).ok()).toBe(true);
  await page.goto(`/app?page=${note.id}`); const editor = page.locator('.workspace > .editor-panel .notebook-editor'); await expect(editor).toBeVisible();
  await editor.locator(`[data-entry-id="${a.id}"]`).first().click(); await expect(page.locator(".knowledge-preview")).toContainText("知识定义");
  await page.getByRole("button", { name: "查看完整词条", exact: true }).click(); const modal = page.locator(".knowledge-dialog");
  await expect(modal).toBeVisible(); await expect(modal.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(modal.locator(".knowledge-backlink").filter({ hasText: "引用来源页面" })).toHaveCount(1);
  await modal.locator(`article [data-entry-id="${b.id}"]`).click(); await expect(modal.getByRole("heading", { name: "虚拟内存", exact: true })).toBeVisible();
  await modal.locator(`article [data-entry-id="${a.id}"]`).click(); await expect(page.locator(".knowledge-dialog")).toHaveCount(1);
  await modal.locator(`article [data-entry-id="${b.id}"]`).click(); await expect(modal.getByRole("heading", { name: "虚拟内存", exact: true })).toBeVisible();
  await modal.locator(`article [data-entry-id="${a.id}"]`).click(); await expect(modal.getByLabel("返回上一词条", { exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "编辑词条", exact: true }).click();
  await modal.getByLabel("词条名称", { exact: true }).fill("操作系统新名"); await modal.getByLabel("词条别名", { exact: true }).fill("OS,Operating System,OS");
  await modal.getByRole("button", { name: "保存", exact: true }).click(); await expect(modal.getByRole("heading", { name: "操作系统新名", exact: true })).toBeVisible();
  await expect(modal.locator('[contenteditable="true"]')).toBeVisible(); await expect(modal.getByLabel("阅读词条", { exact: true })).toHaveCount(0);
  await modal.getByLabel("关闭词条", { exact: true }).click(); await editor.locator(`[data-entry-id="${a.id}"]`).first().click(); await page.getByRole("button", { name: "查看完整词条", exact: true }).click();
  const saved = (await (await page.request.get(`/api/knowledge/${a.id}`)).json()).entry; expect(saved.aliases).toHaveLength(2); expect(saved.content).toContain(b.id);
  await modal.locator(".knowledge-backlink").filter({ hasText: "引用来源页面" }).click();
  await expect(modal).not.toBeVisible(); await expect(page.getByLabel("页面标题", { exact: true })).toHaveValue("引用来源页面"); await expect(editor.locator(`[data-entry-id="${a.id}"]`).first()).toHaveText("@操作系统新名");
  await page.getByRole("button", { name: "知识库", exact: true }).click(); await expect(page.locator(".knowledge-library")).toBeVisible();
  const search = page.getByLabel("搜索知识库", { exact: true }); await search.fill("Operating System"); await expect(page.locator(".knowledge-entry-row")).toHaveCount(1);
  await search.fill("末尾全文检索"); await expect(page.locator(".knowledge-entry-row")).toHaveCount(1); await expect(page.locator(".knowledge-entry-row")).toContainText("操作系统新名");
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator(".knowledge-entry-row").click(); await expect(modal).toBeVisible(); expect((await modal.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expect(page.locator(".knowledge-dialog").getByRole("button", { name: "编辑词条", exact: true })).toHaveCSS("display", /^(inline-)?flex$/); await page.screenshot({ path: testInfo.outputPath("knowledge-mobile.png") });
});

test("manual @ mentions preserve email/code/paste/IME and create only on explicit confirmation", async ({ page, baseURL }) => {
  const { note, a } = await setup(page, baseURL!); await page.goto(`/app?page=${note.id}`); const editor = page.locator('.workspace > .editor-panel .notebook-editor'); await expect(editor).toBeVisible();
  const menu = page.getByRole("listbox", { name: "知识库词条联想" });
  for (const text of ["user@example.com", "hello@world.com", "@@", "@ ", "https://site.test/@test"]) { await editor.fill(""); await editor.pressSequentially(text); await expect(menu).not.toBeVisible(); await expect(editor).toHaveText(text.trimEnd()); }
  await editor.fill(""); await editor.pressSequentially("@"); await expect(menu).toBeVisible(); await editor.press("Escape"); await expect(menu).not.toBeVisible(); await expect(editor).toHaveText("@");
  await editor.fill(""); await editor.pressSequentially("@"); await editor.press("ArrowDown"); await editor.press("Enter"); await expect(editor.locator("[data-knowledge-reference]")).toHaveText("@虚拟内存");
  await editor.fill(""); await editor.pressSequentially("@OS"); await expect(menu).toContainText("操作系统"); await editor.press("Enter"); await expect(editor.locator(`[data-entry-id="${a.id}"]`)).toHaveCount(1);
  await editor.press("Control+z"); await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(0); await editor.press("Control+Shift+z"); await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(1);
  await editor.press("Control+a"); await editor.press("Backspace"); await editor.pressSequentially("@"); await expect(menu).toBeVisible(); await editor.pressSequentially("新概念"); await expect(menu.getByRole("option", { name: "创建词条「新概念」" })).toBeVisible();
  expect((await (await page.request.get("/api/knowledge?q=新概念")).json()).entries).toHaveLength(0);
  await editor.press("Escape"); await expect(editor).toHaveText("@新概念"); expect((await (await page.request.get("/api/knowledge?q=新概念")).json()).entries).toHaveLength(0);
  await editor.fill(""); await editor.pressSequentially("@新概念"); await editor.press("Enter"); await expect(editor.locator("[data-knowledge-reference]")).toHaveText("@新概念");
  await editor.press("Control+s"); await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.content).toContain("knowledgeReference");
  await page.reload(); await expect(editor.locator("[data-knowledge-reference]")).toHaveText("@新概念");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await editor.click(); await editor.press("Control+a"); await editor.press("Control+c"); await editor.press("ArrowRight"); await editor.press("Control+v"); await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(2); await expect(menu).not.toBeVisible();
  // Paste must stay ordinary text rather than invoking the manual trigger.
  await editor.fill(""); await editor.evaluate((element) => { const data = new DataTransfer(); data.setData("text/plain", "@操作系统"); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(editor).toHaveText("@操作系统"); await expect(menu).not.toBeVisible(); await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(0);
  await editor.fill(""); await editor.pressSequentially("@"); await editor.dispatchEvent("compositionstart", { data: "" });
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true }); await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(0); await editor.dispatchEvent("compositionend", { data: "操作" }); await editor.press("Escape");
  await editor.fill(""); await page.getByLabel("标题样式", { exact: true }).selectOption("p");
  await editor.pressSequentially("```"); await editor.press("Space"); await editor.pressSequentially("@test"); await expect(menu).not.toBeVisible();
});

test("reference checks repair exact occurrences without retired tag controls", async ({ page, baseURL }) => {
  const { headers, note, a } = await setup(page, baseURL!);
  await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: 1, content: { type: "doc", content: [{ type: "paragraph", content: [reference(a.id,a.title), reference(a.id,a.title)] }] } } });
  await page.request.delete(`/api/knowledge/${a.id}`, { headers });
  await page.goto(`/app?page=${note.id}`); const editor = page.locator('.workspace > .editor-panel .notebook-editor'); await expect(editor.locator(".knowledge-reference-invalid")).toHaveCount(2);
  await editor.locator("[data-knowledge-reference]").first().click(); await page.getByRole("button", { name: "引用检查与修复", exact: true }).click();
  const check = page.locator(".knowledge-check-dialog"); await check.getByRole("button", { name: "开始检查", exact: true }).click(); await expect(check.locator(".knowledge-check-issue")).toHaveCount(3);
  const source = check.locator(".knowledge-check-issue").filter({ hasText: "引用来源页面" }); await source.first().getByRole("button", { name: "修复此处引用" }).click(); await check.getByRole("radio", { name: "转换为普通文字", exact: true }).check(); await check.getByRole("button", { name: "确认修复", exact: true }).click(); await expect(check.locator(".knowledge-check-issue")).toHaveCount(2);
  await source.first().getByRole("button", { name: "修复此处引用" }).click(); await check.getByRole("radio", { name: "创建新词条", exact: true }).check(); await check.getByLabel("新词条名称").fill("恢复操作系统"); await check.getByRole("button", { name: "确认修复", exact: true }).click(); await expect(check.locator(".knowledge-check-issue")).toHaveCount(1);
  await check.getByLabel("关闭引用检查").click(); await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(1); await expect(editor).toContainText("@操作系统");
  await expect(page.getByLabel("设置标签", { exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/tags")).status()).toBe(404);
});

test("knowledge HTTP ownership, same-origin, versions and CNF2 scopes are enforced", async ({ page, baseURL, playwright }) => {
  const { headers, note, a } = await setup(page, baseURL!);
  expect((await page.request.post("/api/knowledge", { headers, data: { title: "OS" } })).status()).toBe(409);
  expect((await page.request.patch(`/api/knowledge/${a.id}`, { headers, data: { version: 1, title: "过期" } })).status()).toBe(409);
  expect((await page.request.post("/api/knowledge/check", { headers: { Origin: "https://other.invalid" } })).status()).toBe(403);
  const other = await playwright.request.newContext({ baseURL });
  try { expect((await other.get(`/api/knowledge/${a.id}`)).status()).toBe(401); const password="BrowserTest12345"; await other.post("/api/auth/register", { headers, data: { username:`other_${Date.now()}`,password,confirmPassword:password } }); expect((await other.get(`/api/knowledge/${a.id}`)).status()).toBe(404); expect((await other.get(`/api/pages/${note.id}/cnf`)).status()).toBe(404); }
  finally { await other.dispose(); }
  const exported = await page.request.get("/api/knowledge/cnf"); expect(exported.ok()).toBe(true); const bytes = await exported.body();
  // Same-owner conflicts require an explicit reuse decision, never silent overwrite.
  const conflict = await page.request.post("/api/notebooks/import", { headers, multipart: { file: { name: "知识库.cnf", mimeType: "application/zip", buffer: bytes } } }); expect(conflict.status()).toBe(409);
  const reused = await page.request.post("/api/notebooks/import", { headers, multipart: { reuseExisting: "true", file: { name: "知识库.cnf", mimeType: "application/zip", buffer: bytes } } }); expect(reused.status()).toBe(201); expect((await reused.json()).notebook.kind).toBe("knowledge");
  expect((await page.request.get(`/api/pages/${note.id}/cnf`)).ok()).toBe(true);
});

test("new empty entries reuse the editor for references, keyboard save, modal navigation and self-reference guards", async ({ page, baseURL }) => {
  const { headers, note, a } = await setup(page, baseURL!);
  await page.goto(`/app?page=${note.id}`); await expect(page.locator(".notebook-editor")).toBeVisible();
  await page.getByRole("button", { name: "知识库", exact: true }).click(); await page.getByRole("button", { name: "新建词条", exact: true }).click();
  const form = page.getByRole("dialog", { name: "新建词条", exact: true }); await form.getByLabel("正式名称").fill("独立词条"); await form.getByRole("button", { name: "创建词条", exact: true }).click();
  const modal = page.locator(".knowledge-dialog"); await expect(modal.getByRole("heading", { name: "独立词条", exact: true })).toBeVisible(); await expect(modal.getByRole("button", { name: "保存", exact: true })).toBeVisible();
  const editor = modal.locator(".notebook-editor"); await expect(editor).toBeVisible(); await editor.pressSequentially("@OS"); await editor.press("Enter"); await expect(editor.locator(`[data-entry-id="${a.id}"]`)).toHaveCount(1);
  await editor.pressSequentially("@独立词条"); await expect(page.getByRole("option", { name: "创建词条「独立词条」" })).toHaveCount(0); await editor.press("Escape"); await expect(modal).toBeVisible(); await expect(editor).toContainText("@独立词条");
  await editor.click(); await editor.press("Control+s");
  const entry = (await (await page.request.get("/api/knowledge?q=独立词条")).json()).entries.find((item: { title: string }) => item.title === "独立词条");
  await expect.poll(async () => (await (await page.request.get(`/api/knowledge/${entry.id}`)).json()).entry.content).toContain(a.id);
  const originalEditor = await editor.elementHandle();
  await modal.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toBeVisible(); expect(await editor.evaluate((element, original) => element === original, originalEditor)).toBe(true);
  await editor.press("End"); await editor.pressSequentially("继续编辑"); await modal.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/knowledge/${entry.id}`)).json()).entry.content).toContain("继续编辑");
  await editor.locator(`[data-entry-id="${a.id}"]`).click(); await expect(modal.getByRole("heading", { name: "操作系统", exact: true })).toBeVisible(); await expect(page.locator(".knowledge-dialog")).toHaveCount(1);
  await expect(modal.getByLabel("返回上一词条", { exact: true })).toHaveCount(0); await modal.locator(".knowledge-backlink").filter({ hasText: "独立词条" }).click(); await expect(modal.getByRole("heading", { name: "独立词条", exact: true })).toBeVisible(); await modal.getByLabel("关闭词条", { exact: true }).click();
  await expect(page.getByLabel("词条标签筛选", { exact: true })).toHaveCount(0); await expect(page.locator(".knowledge-entry-row")).toContainText(["独立词条", "操作系统", "虚拟内存"]);
});


test("entry alias conflicts retain edits and never adopt an external version to overwrite", async ({ page, baseURL }) => {
  const { headers, note, a } = await setup(page, baseURL!);
  await page.goto(`/app?page=${note.id}`); await expect(page.locator(".notebook-editor")).toBeVisible();
  await page.getByRole("button", { name: "知识库", exact: true }).click(); await page.locator(".knowledge-entry-row").filter({ has: page.locator("strong").filter({ hasText: /^操作系统$/ }) }).click();
  const modal = page.locator(".knowledge-dialog"); await modal.getByRole("button", { name: "编辑词条", exact: true }).click(); await modal.getByLabel("词条别名", { exact: true }).fill("本地别名");
  const original = (await (await page.request.get(`/api/knowledge/${a.id}`)).json()).entry;
  expect((await page.request.patch(`/api/knowledge/${a.id}`, { headers, data: { version: original.version, aliases: ["外部别名"] } })).ok()).toBe(true);
  const conflict = page.waitForResponse((response) => response.url().endsWith(`/api/knowledge/${a.id}`) && response.request().method() === "PATCH" && response.status() === 409);
  await modal.getByRole("button", { name: "保存", exact: true }).click(); await conflict;
  await expect(modal.getByLabel("词条别名", { exact: true })).toHaveValue("本地别名");
  expect((await (await page.request.get(`/api/knowledge/${a.id}`)).json()).entry.aliases).toEqual(["外部别名"]);
  await modal.getByLabel("关闭词条", { exact: true }).click(); const confirmation = page.getByRole("alertdialog"); await expect(confirmation).toBeVisible(); await confirmation.getByRole("button", { name: "取消", exact: true }).click(); await expect(modal).toBeVisible();
  await modal.getByLabel("关闭词条", { exact: true }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "仍然关闭", exact: true }).click(); await expect(modal).not.toBeVisible();
  expect((await (await page.request.get(`/api/knowledge/${a.id}`)).json()).entry.aliases).toEqual(["外部别名"]);
});

test("library route survives refresh and history, previews are opaque in both themes, and external links use a new tab", async ({ page, baseURL }, testInfo) => {
  const { headers, note, a } = await setup(page, baseURL!);
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "维基百科", marks: [{ type: "link", attrs: { href: "https://zh.wikipedia.org/wiki/Docker" } }] }] }] };
  const current = (await (await page.request.get(`/api/knowledge/${a.id}`)).json()).entry;
  expect((await page.request.patch(`/api/knowledge/${a.id}`, { headers, data: { version: current.version, content } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/pages/${note.id}`, { headers, data: { version: 1, content: { type: "doc", content: [{ type: "paragraph", content: [reference(a.id,a.title)] }] } } })).ok()).toBe(true);
  await page.goto(`/app?page=${note.id}`); await page.locator(".notebook-editor [data-knowledge-reference]").click();
  const preview=page.locator(".knowledge-preview"); await expect(preview).toBeVisible(); await expect(preview).toContainText("维基百科");
  const light=await preview.evaluate((element)=>getComputedStyle(element).backgroundColor); expect(light).not.toMatch(/transparent|rgba\([^)]*,\s*0\)/);
  await page.evaluate(()=>document.documentElement.classList.add("dark")); const dark=await preview.evaluate((element)=>getComputedStyle(element).backgroundColor); expect(dark).not.toBe(light); expect(dark).not.toMatch(/transparent|rgba\([^)]*,\s*0\)/);
  await page.screenshot({path:testInfo.outputPath("knowledge-preview-dark.png")});
  await page.context().route("https://zh.wikipedia.org/**",route=>route.fulfill({contentType:"text/html",body:"<p>外链测试</p>"}));
  await preview.getByRole("button",{name:"查看完整词条",exact:true}).click(); const modal=page.locator(".knowledge-dialog"); const link=modal.getByRole("link",{name:"维基百科",exact:true}); await expect(link).toHaveAttribute("rel","noopener noreferrer");
  const opened=page.waitForEvent("popup"); await link.click(); const popup=await opened; await popup.waitForLoadState(); expect(popup.url()).toContain("zh.wikipedia.org/wiki/Docker"); expect(new URL(page.url()).pathname).toBe("/app"); await popup.close(); await expect(modal).toBeVisible(); await modal.getByLabel("关闭词条",{exact:true}).click();
  await page.getByRole("button",{name:"知识库",exact:true}).click(); await expect(page).toHaveURL(/\/app\/library(?:\?|$)/); await expect(page.locator(".sidebar-knowledge-button svg")).toHaveClass(/lucide-library-big/); await expect(page.locator(".knowledge-import svg")).toHaveClass(/lucide-database-arrow-up/);
  await page.reload(); await expect(page.locator(".knowledge-library")).toBeVisible(); await expect(page.getByRole("button",{name:"管理标签",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"返回笔记本",exact:true}).click(); await expect(page).toHaveURL(/\/app(?:\?|$)/); await page.goBack(); await expect(page.locator(".knowledge-library")).toBeVisible(); await expect(page).toHaveURL(/\/app\/library(?:\?|$)/);
  // A concurrent-target 409 without a conflict list is an error, not a broken chooser.
  await page.route("**/api/notebooks/import",route=>route.fulfill({status:409,json:{error:"目标知识库已改变，请重新导入"}}));
  await page.getByLabel("导入知识库文件",{exact:true}).setInputFiles({name:"conflict.cnf",mimeType:"application/zip",buffer:Buffer.from("test")});
  await expect(page.getByText("导入目标已发生变化，请重新选择文件后重试",{exact:true})).toBeVisible(); await expect(page.getByRole("dialog",{name:"处理导入词条冲突",exact:true})).toHaveCount(0);

});

test("administrator restore lists conflicts and supports cancel, reuse and keeping both with remapped references",async({page,baseURL})=>{
  const {headers,a}=await setup(page,baseURL!); const owner=(await (await page.request.get("/api/auth/me")).json()).user;
  const pwd=process.env.E2E_ADMIN_PASSWORD; if(!pwd) throw new Error("Disposable admin password required");
  expect((await page.request.post("/api/auth/login",{headers,data:{username:"admin",password:pwd}})).ok()).toBe(true);
  const me=(await (await page.request.get("/api/auth/me")).json()).user;
  if(me.mustChangePassword){expect((await page.request.post("/api/auth/change-password",{headers,data:{password:pwd,confirmPassword:pwd}})).ok()).toBe(true);expect((await page.request.post("/api/auth/login",{headers,data:{username:"admin",password:pwd}})).ok()).toBe(true);}
  const exported=await page.request.get(`/api/admin/users/${owner.id}/export`); expect(exported.ok()).toBe(true); const zip={name:"user-backup.zip",mimeType:"application/zip",buffer:await exported.body()};
  await page.goto("/admin/users"); const row=page.locator(".admin-user-row").filter({has:page.locator(".admin-user-main strong").filter({hasText:new RegExp(`^${owner.username}$`)})});
  async function select(){await row.locator('input[type="file"]').setInputFiles(zip); await page.getByRole("alertdialog").getByRole("button",{name:"恢复备份",exact:true}).click(); await expect(page.getByRole("dialog",{name:"处理导入词条冲突",exact:true})).toBeVisible();}
  await select(); const conflict=page.getByRole("dialog",{name:"处理导入词条冲突",exact:true}); await expect(conflict.locator("li")).toHaveCount(2); await conflict.getByRole("button",{name:"取消导入",exact:true}).click(); await expect(row.locator('input[type="file"]')).toBeEnabled();
  await select(); await conflict.getByRole("button",{name:"复用已有词条",exact:true}).click(); await expect(page.getByRole("status")).toContainText("复用 2 个");
  await select(); await conflict.getByRole("button",{name:"保留双方并重命名",exact:true}).click(); await expect(page.getByRole("status")).toContainText("重命名 2 个");
  expect((await page.request.post("/api/auth/login",{headers,data:{username:owner.username,password:"BrowserTest12345"}})).ok()).toBe(true);
  const original=(await (await page.request.get(`/api/knowledge/${a.id}`)).json()).entry; expect(original.title).toBe("操作系统"); const list=(await (await page.request.get("/api/knowledge")).json()).entries; expect(list).toHaveLength(4); expect(list.map((item:{title:string})=>item.title)).toContain("操作系统（导入 1）");
  const renamed=list.find((item:{title:string})=>item.title==="操作系统（导入 1）"); const detail=(await (await page.request.get(`/api/knowledge/${renamed.id}`)).json()).entry; const renamedTarget=list.find((item:{title:string})=>item.title==="虚拟内存（导入 1）"); expect(detail.content).toContain(renamedTarget.id);
});
