import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("favicon renders visible pixels at tab size and the legacy ICO URL remains valid", async ({ page, baseURL }) => {
  if (baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  await page.goto("/login");
  const icons = await page.locator('link[rel="icon"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) {
    expect(new URL(icon).pathname).toBe("/icon.png");
    const result = await page.evaluate(async (url) => {
      const image = new Image(); image.src = url; await image.decode();
      const output: { size: number; visible: number }[] = [];
      for (const size of [16, 32]) {
        const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        let visible = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visible++;
        output.push({ size, visible });
      }
      return output;
    }, icon);
    for (const sample of result) expect(sample.visible, `${sample.size}px favicon must not be transparent`).toBeGreaterThan(0);
  }
  const png = await page.request.get("/icon.png");
  expect(png.headers()["content-type"]).toContain("image/png");
  expect(await png.body()).toEqual(await readFile("src/app/icon.png"));
  const redirect = await page.request.get("/favicon.ico", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers().location).toBe("/icon.png");
  const legacy = await page.request.get("/favicon.ico");
  expect(legacy.ok()).toBeTruthy();
  expect(await legacy.body()).toEqual(await png.body());
});
