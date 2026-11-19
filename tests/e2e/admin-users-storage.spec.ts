import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const password = "BrowserTest12345";
async function register(api: APIRequestContext, baseURL: string, prefix: string) {
  const username = `${prefix}_${Date.now()}`;
  const response = await api.post("/api/auth/register", { headers: { Origin: baseURL }, data: { username, password, confirmPassword: password } });
  expect(response.status()).toBe(201);
  return (await response.json()).user as { id: string; username: string };
}
async function admin(page: Page, baseURL: string) {
  const pwd = process.env.E2E_ADMIN_PASSWORD;
  if (!pwd) throw new Error("Disposable E2E_ADMIN_PASSWORD required");
  const headers = { Origin: baseURL };
  let response = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password: pwd } });
  expect(response.ok()).toBeTruthy();
  if ((await response.json()).user.mustChangePassword) {
    expect((await page.request.post("/api/auth/change-password", { headers, data: { password: pwd, confirmPassword: pwd } })).ok()).toBeTruthy();
    response = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password: pwd } });
    expect(response.ok()).toBeTruthy();
  }
}
async function upload(api: APIRequestContext, baseURL: string, name: string) {
  const response = await api.post("/api/assets/upload", { headers: { Origin: baseURL }, multipart: { file: { name, mimeType: "image/png", buffer: await readFile("tests/fixtures/cover.png") } } });
  expect(response.status()).toBe(201);
  return (await response.json()).asset as { id: string; url: string };
}
function removeDisposableFiles(ids: string[]) {
  const container = "cloud-notebook-v31-e2e";
  const [config] = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }));
  expect(config.Config.Labels["com.docker.compose.project"]).toBe("cloud-notebook-e2e");
  expect(config.HostConfig.Tmpfs["/app/data"]).toBeTruthy();
  // Argument array, no shell; hardcoded disposable DB and managed upload root.
  execFileSync("docker", ["exec", container, "node", "-e", `
    const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');
    const db=new Database('/app/data/v31-e2e.db');
    for(const id of process.argv.slice(1)) {
      if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('invalid asset');
      const asset=db.prepare('SELECT storage_path FROM assets WHERE id=?').get(id);
      if(!asset || path.basename(asset.storage_path)!==asset.storage_path || !asset.storage_path.startsWith(id+'.'))throw Error('unsafe fixture');
      const file=path.join('/app/data/uploads/notes',asset.storage_path);
      if(fs.lstatSync(file).isSymbolicLink())throw Error('unsafe fixture');
      fs.unlinkSync(file);
    }
    db.close();
  `, ...ids]);
}

test.beforeEach(async ({ baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
});

test("login error placeholder keeps form and buttons stable at desktop and mobile widths", async ({ page }, testInfo) => {
  let message = "用户名或密码错误";
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 401, json: { error: message } }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    const submit = page.getByRole("button", { name: "登录", exact: true });
    const card = (await page.locator(".auth-card").boundingBox())!;
    const initial = (await submit.boundingBox())!;
    await page.getByLabel("用户名", { exact: true }).fill("nonexistent");
    await page.getByLabel("密码", { exact: true }).fill("wrong-password");
    for (message of ["用户名或密码错误", "服务器暂时无法完成登录，请稍后重试。如果问题持续发生，请联系管理员确认服务状态。".repeat(3)]) {
      await submit.click();
      await expect(page.locator(".auth-error-slot")).toHaveText(message);
      expect((await submit.boundingBox())!.y).toBe(initial.y);
      expect((await page.locator(".auth-card").boundingBox())!.y).toBe(card.y);
    }
    await page.screenshot({ path: testInfo.outputPath(`login-error-${width}.png`) });
  }
});

test("admin layout stays full-width with stable mobile navigation and user deletion is authorized and confirmed", async ({ page, browser, baseURL }, testInfo) => {
  const victim = await browser.newContext({ baseURL });
  const other = await browser.newContext({ baseURL });
  try {
    const user = await register(victim.request, baseURL!, "delete");
    await register(other.request, baseURL!, "keep");
    const asset = await upload(victim.request, baseURL!, "owned.png");
    const headers = { Origin: baseURL! };
    const { notebook } = await (await victim.request.post("/api/notebooks", { headers, data: { title: "Delete fixture" } })).json();
    const { page: note } = await (await victim.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "Delete page" } })).json();
    expect((await victim.request.patch(`/api/pages/${note.id}`, { headers, data: { version: note.version, content: { type: "doc", content: [{ type: "image", attrs: { assetId: asset.id, src: asset.url } }] } } })).ok()).toBeTruthy();
    expect((await victim.request.delete(`/api/admin/users/${user.id}`, { headers })).status()).toBe(403);
    await admin(page, baseURL!);
    const me = (await (await page.request.get("/api/auth/me")).json()).user;
    expect((await page.request.delete(`/api/admin/users/${me.id}`, { headers })).status()).toBe(404);
    expect((await page.request.delete(`/api/admin/users/${user.id}`, { headers: { Origin: "https://invalid.example" } })).status()).toBe(403);
    for (const width of [2100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      let navHeight: number | undefined;
      for (const route of ["/admin", "/admin/users", "/admin/assets", "/admin/backups", "/admin/settings"]) {
        await page.goto(route);
        await expect(page.locator(".admin-title")).toBeVisible();
        const nav = (await page.locator(".admin-nav").boundingBox())!, main = (await page.locator(".admin-main").boundingBox())!;
        expect(Math.abs(main.x + main.width - width)).toBeLessThan(2);
        expect(main.height).toBeGreaterThanOrEqual(900 - main.y - 1);
        if (width === 390) {
          if (navHeight === undefined) navHeight = nav.height;
          expect(nav.height).toBe(navHeight);
          expect(nav.height).toBeLessThan(90);
        }
      }
    }
    await page.goto("/admin/users");
    const row = page.locator(".admin-user-row").filter({ has: page.getByText(user.username, { exact: true }) });
    await expect(row.locator(".admin-user-metrics dt")).toHaveText(["笔记本", "页面", "词条", "图片", "存储用量"]);
    expect((await row.locator(".admin-user-metrics dd").allTextContents()).slice(0, 4)).toEqual(["1", "1", "0", "1"]);
    const remove = row.getByRole("button", { name: "删除用户", exact: true });
    await expect(remove).toHaveCSS("background-color", "rgb(186, 57, 50)");
    await page.screenshot({ path: testInfo.outputPath("admin-users-mobile.png"), fullPage: true });
    await remove.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toBeVisible(); expect((await victim.request.get("/api/auth/me")).status()).toBe(200);
    await remove.click();
    const response = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api/admin/users/${user.id}`);
    await page.getByRole("alertdialog").getByRole("button", { name: "永久删除用户", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(row).toHaveCount(0);
    expect((await victim.request.get("/api/auth/me")).status()).toBe(401);
    expect((await page.request.get(asset.url)).status()).toBe(404);
    expect((await other.request.get("/api/auth/me")).status()).toBe(200);
  } finally { await victim.close(); await other.close(); }
});

test("storage UI cleans selected and bulk missing records while preserving referenced records", async ({ page, browser, baseURL }, testInfo) => {
  const userContext = await browser.newContext({ baseURL });
  try {
    const user = await register(userContext.request, baseURL!, "missing");
    const free = await upload(userContext.request, baseURL!, "missing-safe.png");
    const referenced = await upload(userContext.request, baseURL!, "missing-protected.png");
    const headers = { Origin: baseURL! };
    const { notebook } = await (await userContext.request.post("/api/notebooks", { headers, data: { title: "Protected" } })).json();
    const { page: note } = await (await userContext.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: {} })).json();
    expect((await userContext.request.patch(`/api/pages/${note.id}`, { headers, data: { version: note.version, content: { type: "doc", content: [{ type: "image", attrs: { assetId: referenced.id, src: referenced.url } }] } } })).ok()).toBeTruthy();
    removeDisposableFiles([free.id, referenced.id]);
    await admin(page, baseURL!);
    await page.goto("/admin/assets");
    await page.locator(".asset-filters select").first().selectOption(user.id);
    const freeRow = page.locator(".asset-row").filter({ hasText: free.id.slice(0, 8) });
    const protectedRow = page.locator(".asset-row").filter({ hasText: referenced.id.slice(0, 8) });
    await expect(freeRow.getByRole("checkbox")).toBeEnabled();
    await expect(protectedRow.getByRole("checkbox")).toBeDisabled();
    await freeRow.getByRole("checkbox").check();
    await page.getByRole("button", { name: "清理选中 (1)", exact: true }).click();
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/assets/cleanup");
    await page.getByRole("alertdialog").getByRole("button", { name: "清理选中图片", exact: true }).click();
    expect(await (await response).json()).toMatchObject({ deleted: 1, missingRecords: 1, reclaimedBytes: 0 });
    await expect(freeRow).toHaveCount(0); await expect(protectedRow).toBeVisible();
    const bulk = await upload(userContext.request, baseURL!, "missing-bulk.png"); removeDisposableFiles([bulk.id]);
    await page.getByRole("button", { name: "重新扫描", exact: true }).click();
    await expect(page.locator(".asset-row").filter({ hasText: bulk.id.slice(0, 8) })).toBeVisible();
    await page.getByRole("button", { name: "清理全部安全候选", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "清理全部冗余图片", exact: true }).click();
    await expect(page.locator(".asset-row").filter({ hasText: bulk.id.slice(0, 8) })).toHaveCount(0);
    await expect(protectedRow).toBeVisible();
    const blocked = await page.request.post("/api/admin/assets/cleanup", { headers, data: { assetIds: [referenced.id] } });
    expect((await blocked.json()).deleted).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("missing-record-cleanup.png"), fullPage: true });
  } finally { await userContext.close(); }
});
