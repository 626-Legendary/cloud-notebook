import { test, expect, type Page } from "@playwright/test";
const password = "BrowserTest12345";
async function register(page: Page, baseURL: string) {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const headers = { Origin: baseURL };
  const response = await page.request.post("/api/auth/register", { headers, data: { username: `knowledge_fix_${Date.now()}`, password, confirmPassword: password } });
  expect(response.status()).toBe(201); return { headers, user: (await response.json()).user };
}

test("Chromium IME commits recover @Chinese, replacements and CJK boundaries without bypassing Escape", async ({ page, baseURL }) => {
  const { headers } = await register(page,baseURL!);
  const { entry } = await (await page.request.post("/api/knowledge",{headers,data:{title:"内存",aliases:["RAM"]}})).json();
  const { notebook } = await (await page.request.post("/api/notebooks",{headers,data:{title:"输入法测试"}})).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`,{headers,data:{title:"中文输入"}})).json();
  await page.goto(`/app?page=${note.id}`); const editor=page.locator(".notebook-editor"); await expect(editor).toBeVisible();
  const menu=page.getByRole("listbox",{name:"知识库词条联想"}); const cdp=await page.context().newCDPSession(page);
  try {
    for(const prefix of ["", "了解", "@"]){
      await editor.fill(""); if(prefix) await editor.pressSequentially(prefix);
      const committed=prefix==="@"?"内存":"@内存";
      await cdp.send("Input.imeSetComposition",{text:committed,selectionStart:committed.length,selectionEnd:committed.length});
      await expect(menu).not.toBeVisible(); await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(0);
      await cdp.send("Input.insertText",{text:committed}); await expect(menu.getByRole("option").filter({hasText:"内存"})).toBeVisible();
      await expect(editor.locator("[data-knowledge-reference]")).toHaveCount(0); await editor.press("Enter"); await expect(editor.locator(`[data-entry-id="${entry.id}"]`)).toHaveCount(1);
    }
    await editor.fill(""); await editor.pressSequentially("@"); await expect(menu).toBeVisible();
    await cdp.send("Input.imeSetComposition",{text:"@内存",selectionStart:3,selectionEnd:3,replacementStart:0,replacementEnd:1}); await cdp.send("Input.insertText",{text:"@内存"}); await expect(menu).toContainText("内存");
    await editor.press("Escape"); await editor.fill(""); await editor.pressSequentially("@"); await editor.press("Escape");
    await cdp.send("Input.imeSetComposition",{text:"内存",selectionStart:2,selectionEnd:2}); await cdp.send("Input.insertText",{text:"内存"}); await expect(menu).not.toBeVisible(); await expect(editor).toHaveText("@内存");
    await editor.press("Control+a"); await editor.press("Backspace"); await cdp.send("Input.imeSetComposition",{text:"@内存",selectionStart:3,selectionEnd:3}); await cdp.send("Input.insertText",{text:"@内存"}); await expect(menu).toContainText("内存"); await editor.press("Escape");
    await editor.fill("user"); await editor.press("End"); await cdp.send("Input.imeSetComposition",{text:"@内存",selectionStart:3,selectionEnd:3}); await cdp.send("Input.insertText",{text:"@内存"}); await expect(menu).not.toBeVisible();
    expect((await (await page.request.get("/api/knowledge")).json()).entries).toHaveLength(1);
  } finally { await cdp.detach(); }
});

test("administrator overview, user metrics and paged knowledge list include entries with role checks", async ({ page, baseURL }, testInfo) => {
  const { headers,user }=await register(page,baseURL!);
  expect((await page.request.get("/api/admin/knowledge")).status()).toBe(403);
  const ids:string[]=[];
  for(let index=0;index<23;index++){const result=await page.request.post("/api/knowledge",{headers,data:{title:`后台词条 ${index}`,aliases:[`AdminAlias ${index}`]}}); expect(result.status()).toBe(201); ids.push((await result.json()).entry.id);}
  for(const id of ids.slice(0,2)) expect((await page.request.delete(`/api/knowledge/${id}`,{headers})).ok()).toBe(true);
  const pwd=process.env.E2E_ADMIN_PASSWORD;if(!pwd)throw new Error("Disposable admin password required");
  let login=await page.request.post("/api/auth/login",{headers,data:{username:"admin",password:pwd}});expect(login.ok()).toBe(true);
  if((await login.json()).user.mustChangePassword){expect((await page.request.post("/api/auth/change-password",{headers,data:{password:pwd,confirmPassword:pwd}})).ok()).toBe(true);login=await page.request.post("/api/auth/login",{headers,data:{username:"admin",password:pwd}});expect(login.ok()).toBe(true);}
  const overview=await (await page.request.get("/api/admin/overview")).json();expect(overview.entries).toBeGreaterThanOrEqual(21);expect(typeof overview.images).toBe("number");
  const users=(await (await page.request.get("/api/admin/users")).json()).users;expect(users.find((item:{id:string})=>item.id===user.id).entryCount).toBe(21);
  const result=await (await page.request.get(`/api/admin/knowledge?q=${encodeURIComponent(user.username)}`)).json();expect(result.total).toBe(21);expect(result.entries).toHaveLength(20);expect(result.entries.every((entry:Record<string,unknown>)=>!("content"in entry))).toBe(true);
  expect((await page.request.get("/api/admin/knowledge?page=0")).status()).toBe(400);
  await page.goto("/admin");await expect(page.locator(".metric-card").filter({hasText:"知识库词条"})).toBeVisible();
  await page.getByRole("link",{name:"知识库",exact:true}).click();await expect(page.getByRole("link",{name:"知识库",exact:true})).toHaveAttribute("aria-current","page");
  await page.getByLabel("搜索管理词条").fill(user.username);await expect(page.locator(".admin-knowledge-row")).toHaveCount(20);await page.getByLabel("下一页词条").click();await expect(page.locator(".admin-knowledge-row")).toHaveCount(1);
  await page.getByLabel("词条状态").selectOption("trash");await expect(page.locator(".admin-knowledge-row")).toHaveCount(2);await expect(page.locator(".admin-entry-status").first()).toHaveText("已删除");
  await page.setViewportSize({width:390,height:844});expect(await page.locator(".admin-main").evaluate((element)=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath("admin-knowledge-mobile.png")});
});
