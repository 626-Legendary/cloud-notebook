import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("admin user and asset buttons keep icons and text aligned at desktop and mobile widths", async ({ page, baseURL }, testInfo) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || !["3001", "3002"].includes(new URL(baseURL!).port)) throw new Error("Disposable test service required");
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) throw new Error("E2E_ADMIN_PASSWORD is required for the disposable admin");
  const headers = { Origin: baseURL! };
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `buttons_${Date.now()}`, password: "BrowserTest12345", confirmPassword: "BrowserTest12345" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/assets/upload", { headers, multipart: { file: { name: "button-preview.png", mimeType: "image/png", buffer: await readFile("tests/fixtures/cover.png") } } })).ok()).toBeTruthy();
  let login = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password } });
  expect(login.ok()).toBeTruthy();
  if ((await login.json()).user.mustChangePassword) {
    expect((await page.request.post("/api/auth/change-password", { headers, data: { password, confirmPassword: password } })).ok()).toBeTruthy();
    login = await page.request.post("/api/auth/login", { headers, data: { username: "admin", password } });
    expect(login.ok()).toBeTruthy();
  }
  for (const route of ["users", "assets"]) {
    await page.goto(`/admin/${route}`);
    if (route === "users") await expect(page.locator(".admin-user-actions").first()).toBeVisible();
    else await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const controls = page.locator('.admin-main :is(.button-primary, .button-outline, .button-danger, .button-subtle)');
      for (const control of await controls.all()) {
        await expect(control).toHaveCSS("display", /^(inline-)?flex$/);
        await expect(control).toHaveCSS("white-space", "nowrap");
        const layout = await control.evaluate((element) => {
          const icon = element.querySelector(":scope > svg");
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let text: Node | null = null;
          while ((text = walker.nextNode())) if (text.textContent?.trim()) break;
          if (!icon || !text) return null;
          const range = document.createRange(); range.selectNodeContents(text);
          const label = range.getBoundingClientRect(); const svg = icon.getBoundingClientRect();
          return { iconRight: svg.right, labelLeft: label.left, centerDifference: Math.abs((svg.top + svg.bottom - label.top - label.bottom) / 2), fits: element.scrollWidth <= element.clientWidth };
        });
        if (layout) {
          expect(layout.iconRight).toBeLessThanOrEqual(layout.labelLeft);
          expect(layout.centerDifference).toBeLessThan(3);
          expect(layout.fits).toBe(true);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`admin-${route}-${width}.png`), fullPage: true });
    }
    if (route === "assets") {
      await page.getByRole("button", { name: "重新扫描", exact: true }).click();
      await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeEnabled();
    }
  }
});
