import { test, expect } from "@playwright/test";

test("empty and short paper fill available height without changing versions", async ({ page, baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable server required");
  const headers = { Origin: baseURL };
  const password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `paper_${Date.now()}`, password, confirmPassword: password } })).ok()).toBe(true);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "纸张验证" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "空白页面" } })).json();
  await page.goto(`/app?page=${note.id}`);
  await expect(page.locator(".notebook-editor")).toBeVisible();
  for (const [width, height] of [[2560, 1280], [1440, 900], [1024, 900], [390, 900]]) {
    await page.setViewportSize({ width, height });
    for (const dark of [false, true]) {
      await page.locator("html").evaluate((element, value) => element.classList.toggle("dark", value), dark);
      const dimensions = await page.locator(".editor-content-wrap").evaluate((paper) => ({ paper: paper.clientHeight, available: paper.parentElement!.clientHeight, bottom: paper.parentElement!.getBoundingClientRect().bottom - paper.getBoundingClientRect().bottom }));
      expect(dimensions.paper).toBeGreaterThan(dimensions.available - 50);
      expect(dimensions.bottom).toBeGreaterThanOrEqual(14);
      expect(dimensions.bottom).toBeLessThanOrEqual(24);
    }
  }
  expect((await (await page.request.get(`/api/pages/${note.id}`)).json()).page.version).toBe(note.version);
  await page.locator(".notebook-editor").fill("这是一段短正文。");
  const bottom = await page.locator(".editor-content-wrap").evaluate((paper) => paper.parentElement!.getBoundingClientRect().bottom - paper.getBoundingClientRect().bottom);
  expect(bottom).toBeGreaterThanOrEqual(14);
  expect(bottom).toBeLessThanOrEqual(24);
});

test("page panel resizing preserves editing, persists width and shares edge scrollbars and hierarchy", async ({ page, baseURL }, testInfo) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const headers = { Origin: baseURL }, password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `panels_${Date.now()}`, password, confirmPassword: password } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "默认文件夹中的笔记本" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "布局编辑验证" } })).json();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/app?page=${note.id}`);
  const editor = page.locator(".notebook-editor"); await expect(editor).toBeVisible();
  await editor.evaluate((element) => { element.dataset.resizeProbe = "kept"; });
  await page.getByLabel("页面标题", { exact: true }).fill("拖动后保留的编辑");
  const panel = page.locator(".pages-panel"), handle = page.getByRole("separator", { name: "调整页面面板宽度", exact: true });
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  const drag = async (distance: number) => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 110); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + distance, box.y + 110, { steps: 8 }); await page.mouse.up();
  };
  await drag(80); await expect(handle).toHaveAttribute("aria-valuenow", "380");
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(380);
  await drag(300); await expect(handle).toHaveAttribute("aria-valuenow", "450");
  await expect(editor).toHaveAttribute("data-resize-probe", "kept");
  await expect(page.getByLabel("页面标题", { exact: true })).toHaveValue("拖动后保留的编辑");
  await handle.press("ArrowLeft"); await expect(handle).toHaveAttribute("aria-valuenow", "440");
  await handle.press("Home"); await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await handle.press("ArrowLeft"); await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await handle.press("End"); await expect(handle).toHaveAttribute("aria-valuenow", "450");
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await (await page.request.get(`/api/pages/${note.id}`)).json()).page.title).toBe("拖动后保留的编辑");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cloud-notebook:pages-panel-width"))).toBe("450");
  await page.reload(); await expect(editor).toBeVisible();
  await expect(handle).toHaveAttribute("aria-valuenow", "450");
  const folderIcon = page.locator(".folder-row .folder-icon");
  const child = page.locator(".notebook-icon");
  expect((await child.boundingBox())!.x).toBeGreaterThan((await folderIcon.boundingBox())!.x + 16);
  const gutter = async (list: string, parent: string) => {
    const listBox = (await page.locator(list).boundingBox())!, parentBox = (await page.locator(parent).boundingBox())!;
    return Math.abs(listBox.x + listBox.width - parentBox.x - parentBox.width);
  };
  expect(await gutter(".folder-tree", ".sidebar")).toBeLessThanOrEqual(2);
  expect(await gutter(".pages-panel-scroll", ".pages-panel")).toBeLessThanOrEqual(2);
  const divider = (await page.locator(".sidebar-brand-divider").first().boundingBox())!;
  expect((await page.locator(".workspace-new-button").boundingBox())!.y - divider.y - divider.height).toBeGreaterThanOrEqual(16);
  await expect(page.locator(".brand-small img")).toHaveAttribute("src", "/icon.png");
  const search = page.getByRole("button", { name: "搜索当前页面", exact: true });
  expect(await search.evaluate((element) => element.parentElement === document.querySelector(".toolbar-formatting > .toolbar-search"))).toBe(true);
  const undo = (await page.getByRole("button", { name: "重做", exact: true }).boundingBox())!;
  expect((await search.boundingBox())!.x).toBeGreaterThan(undo.x + undo.width);
  expect((await search.boundingBox())!.x - undo.x - undo.width).toBeLessThan(50);
  expect(Math.abs((await search.boundingBox())!.y - (await page.locator(".formatting-toolbar").boundingBox())!.y)).toBeLessThanOrEqual(2);
  await search.click(); await expect(page.getByRole("searchbox", { name: "搜索当前页面正文" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("workspace-wide-panel.png"), fullPage: true });
  await editor.evaluate((element) => { element.dataset.viewportProbe="kept"; });
  for (const width of [390,600,601,768]) {
    await page.setViewportSize({width,height:844});
    if(width<=600) await expect(page.locator(".toolbar-formatting")).not.toBeVisible();
    else await expect(page.locator(".toolbar-formatting")).toBeVisible();
    await expect(editor).toHaveAttribute("data-viewport-probe","kept");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).not.toBeVisible();
  await page.getByLabel("显示页面列表", { exact: true }).click();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(290);
});

test("workspace navigation, export choices and trash route share the refined layout",async({page,baseURL},testInfo)=>{
 if(process.env.E2E_ALLOW_MUTATIONS!=="1" || baseURL!=="http://127.0.0.1:3002")throw new Error("Disposable server required");
 await page.goto("/login");await expect(page.locator(".brand-mark img")).toHaveAttribute("src","/icon.png");
 expect((await page.locator(".brand-mark").boundingBox())!.width).toBe(64);
 expect((await page.locator(".brand-mark img").boundingBox())!.width).toBe(48);
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:testInfo.outputPath("login-brand-desktop.png")});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add("dark"));await page.screenshot({path:testInfo.outputPath("login-brand-mobile-dark.png")});
 await page.setViewportSize({width:1440,height:900});
 const headers={Origin:baseURL!},password="BrowserTest12345";
 expect((await page.request.post("/api/auth/register",{headers,data:{username:`layout_${Date.now()}`,password,confirmPassword:password}})).status()).toBe(201);
 const {notebook}=await(await page.request.post("/api/notebooks",{headers,data:{title:"布局笔记本"}})).json();
 const {page:note}=await(await page.request.post(`/api/notebooks/${notebook.id}/pages`,{headers,data:{title:"布局页面"}})).json();
 await page.setViewportSize({width:1440,height:900});await page.goto(`/app?page=${note.id}`);await expect(page.locator(".notebook-editor")).toBeVisible();
 expect((await page.locator(".sidebar").boundingBox())!.width).toBe(260);await expect(page.locator(".pages-panel-title")).toHaveCount(0);
 await expect(page.getByLabel("应用版本")).toHaveText("Ver 1.1.1119d");
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator(".sidebar-toggle")).toBeHidden();
 const breadcrumbs = page.getByRole("navigation", {name:"页面路径"});
 await expect(breadcrumbs.getByRole("button")).toHaveCount(0);
 await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText("布局页面");
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole("button",{name:"导出",exact:true}).click();
 await expect(page.locator(".export-format-actions button")).toHaveText(["打印 / 保存为 PDF","导出原生文件 (.cnf)","取消"]);
 await page.getByRole("button",{name:"取消",exact:true}).click();
 await page.getByRole("button",{name:"账号与设置",exact:true}).click();await page.getByRole("menuitem",{name:"数据管理",exact:true}).hover();await page.getByRole("menuitem",{name:"引用管理",exact:true}).click();await expect(page.getByRole("heading",{name:"引用管理",exact:true})).toBeVisible();await page.getByLabel("关闭引用检查",{exact:true}).click();
 expect((await page.request.post("/api/pins",{headers,data:{type:"notebook",id:notebook.id}})).ok()).toBe(true);await page.reload();
 await expect(page.locator(".pinned-item").filter({hasText:notebook.title}).locator("svg")).toHaveClass(/lucide-notebook-pen/);
 await page.getByRole("button",{name:"知识库",exact:true}).click();
 await expect(page.locator(".workspace-view-topbar").getByRole("button",{name:"返回",exact:true}).locator("svg")).toHaveClass(/lucide-arrow-left/);
 await page.getByRole("button",{name:"返回",exact:true}).click();
 await page.getByRole("button",{name:"垃圾箱",exact:true}).click();await expect(page).toHaveURL(/\/app\/trash/);await expect(page.locator(".pages-panel")).toHaveCount(0);await page.reload();await expect(page.locator(".trash-page")).toBeVisible();
 await expect(page.locator(".workspace-view-topbar").getByRole("button",{name:"返回",exact:true}).locator("svg")).toHaveClass(/lucide-arrow-left/);
 await page.screenshot({path:testInfo.outputPath("trash-route.png")});
 await page.getByRole("button",{name:"返回",exact:true}).click();await expect(page.locator(".notebook-editor")).toBeVisible();
});

test("code language and copy preserve source while paper fills the viewport", async ({page,baseURL}) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable server required");
  const headers = {Origin:baseURL}, password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register",{headers,data:{username:`code_${Date.now()}`,password,confirmPassword:password}})).ok()).toBe(true);
  const {notebook} = await (await page.request.post("/api/notebooks",{headers,data:{title:"代码"}})).json();
  const {page:note} = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`,{headers,data:{title:"脚本"}})).json();
  const code = "def hello():\n    return 1\n# @" + "x".repeat(400);
  expect((await page.request.patch(`/api/pages/${note.id}`,{headers,data:{version:note.version,content:{type:"doc",content:[{type:"codeBlock",content:[{type:"text",text:code}]}]}}})).ok()).toBe(true);
  await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
  await page.goto(`/app?page=${note.id}`);
  const block = page.locator(".document-code-block");
  const language = block.getByLabel("代码语言");
  await expect(language).toHaveValue("");
  await expect(block.locator(".hljs-keyword")).toHaveCount(0);
  await language.selectOption("python");
  const keyword = block.locator(".hljs-keyword").first();
  await expect(keyword).toHaveText("def");
  const lightColor = await keyword.evaluate((element) => getComputedStyle(element).color);
  await page.locator("html").evaluate((html) => html.classList.add("dark"));
  await expect(keyword).not.toHaveCSS("color", lightColor);
  await page.locator("html").evaluate((html) => html.classList.remove("dark"));
  await block.getByRole("button",{name:"复制代码"}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
  await expect.poll(()=>block.locator("pre").evaluate((element)=>element.scrollWidth>element.clientWidth)).toBe(true);
  for (const [width,height] of [[1920,1080],[1440,900],[1366,768],[1024,768]]) {
    await page.setViewportSize({width,height});
    const gap = await page.locator(".editor-content-wrap").evaluate((paper)=>paper.parentElement!.getBoundingClientRect().bottom-paper.getBoundingClientRect().bottom);
    expect(gap).toBeGreaterThanOrEqual(14);
    expect(gap).toBeLessThanOrEqual(24);
  }
  await expect.poll(async ()=>{
    const result = await (await page.request.get(`/api/pages/${note.id}`)).json();
    return JSON.parse(result.page.content).content[0].attrs?.language;
  },{timeout:20000}).toBe("python");
  const print = await page.context().newPage();
  await print.goto(`/print/page/${note.id}`);
  expect(await print.locator("pre code").textContent()).toBe(code);
  await print.close();
  const editor = page.locator(".notebook-editor");
  await block.locator("code").click();
  await page.keyboard.press("End");
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.insertText", { text: "中文@" });
    await expect(block.locator("code")).toContainText("中文@");
    await expect(page.getByRole("listbox", { name: "知识库词条联想" })).toHaveCount(0);
    await editor.press("Control+z");
    await expect(block.locator("code")).not.toContainText("中文@");
    await editor.press("Control+Shift+z");
    await expect(block.locator("code")).toContainText("中文@");
  } finally { await cdp.detach(); }
  await page.keyboard.insertText("\n# long line".repeat(90));
  await expect.poll(() => page.locator(".editor-content-wrap").evaluate((paper) =>
    paper.getBoundingClientRect().height > paper.parentElement!.clientHeight
      && paper.parentElement!.scrollWidth <= paper.parentElement!.clientWidth,
  )).toBe(true);
  const {entry} = await (await page.request.post("/api/knowledge",{headers,data:{title:"代码词条",content:{type:"doc",content:[{type:"codeBlock",attrs:{language:"python"},content:[{type:"text",text:code}]}]}}})).json();
  expect(entry.id).toBeTruthy();
  await page.goto("/app/library");
  await page.getByRole("button",{name:"打开词条：代码词条"}).click();
  const dialog = page.locator(".knowledge-dialog");
  await expect(dialog.locator(".hljs-keyword").first()).toHaveText("def");
  await dialog.getByRole("button",{name:"复制代码"}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
  await dialog.getByRole("button",{name:"编辑词条"}).click();
  await expect(dialog.getByLabel("代码语言")).toHaveValue("python");
});
