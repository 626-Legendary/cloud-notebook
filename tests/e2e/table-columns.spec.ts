import { test, expect } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test("table column limit blocks UI, both commands and raw transactions at 20, including merged cells", async ({ page, baseURL }) => {
  if (process.env.E2E_ALLOW_MUTATIONS !== "1" || baseURL !== "http://127.0.0.1:3002") throw new Error("Disposable 3002 server required");
  const headers = { Origin: baseURL }, password = "BrowserTest12345";
  expect((await page.request.post("/api/auth/register", { headers, data: { username: `columns_${Date.now()}`, password, confirmPassword: password } })).status()).toBe(201);
  const { notebook } = await (await page.request.post("/api/notebooks", { headers, data: { title: "列数边界" } })).json();
  const { page: note } = await (await page.request.post(`/api/notebooks/${notebook.id}/pages`, { headers, data: { title: "19 到 20 列" } })).json();
  await page.goto(`/app?page=${note.id}`);
  const editor = page.locator(".notebook-editor");
  await expect(editor).toBeVisible();
  for (const merged of [false, true]) {
    await editor.evaluate((element, merge) => {
      const active = (element as HTMLElement & { editor: Editor }).editor;
      const cell = (colspan = 1) => ({ type: "tableCell", attrs: { colspan, rowspan: 1 }, content: [{ type: "paragraph" }] });
      active.commands.setContent({ type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: merge ? [cell(2), ...Array.from({ length: 17 }, () => cell())] : Array.from({ length: 19 }, () => cell()) }] }] });
      active.commands.setTextSelection(4);
    }, merged);
    const insert = page.getByRole("button", { name: "右侧插入列", exact: true });
    await expect(insert).toBeEnabled(); await insert.click(); await expect(insert).toBeDisabled();
    const outcomes = await editor.evaluate((element) => {
      const active = (element as HTMLElement & { editor: Editor }).editor;
      const before = active.commands.addColumnBefore(), after = active.commands.addColumnAfter();
      const beforeDoc = JSON.stringify(active.getJSON());
      const table = { type: "table", content: [{ type: "tableRow", content: Array.from({ length: 21 }, () => ({ type: "tableCell", content: [{ type: "paragraph" }] })) }] };
      active.view.dispatch(active.state.tr.replaceWith(0, active.state.doc.content.size, active.schema.nodeFromJSON(table)));
      return { before, after, unchanged: JSON.stringify(active.getJSON()) === beforeDoc, insertLarge: active.commands.insertTable({ rows: 1, cols: 21 }) };
    });
    expect(outcomes).toEqual({ before: false, after: false, unchanged: true, insertLarge: false });
    await page.getByRole("button", { name: "删除列", exact: true }).click();
    await expect(insert).toBeEnabled();
  }
});
