import { afterEach, expect, it, vi } from "vitest";
import { requestLogout } from "@/lib/logout-client";
afterEach(() => vi.unstubAllGlobals());
it("waits for logout confirmation without a second request on success", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetch);
  await requestLogout();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST", cache: "no-store" }));
});
it("accepts an uncertain response only when the server confirms the session is gone", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("connection interrupted")).mockResolvedValueOnce(Response.json({ error: "请先登录" }, { status: 401 })); vi.stubGlobal("fetch", fetch);
  await expect(requestLogout()).resolves.toBeUndefined();
  expect(fetch).toHaveBeenLastCalledWith("/api/auth/me", expect.objectContaining({ cache: "no-store" }));
});
it("reports a failed logout instead of pretending a still-active session ended", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "退出失败" }, { status: 503 })).mockResolvedValueOnce(Response.json({ user: { id: "still-active" } })); vi.stubGlobal("fetch", fetch);
  await expect(requestLogout()).rejects.toThrow("退出失败");
});
it("reports timeout and unconfirmed state explicitly", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new DOMException("timeout", "TimeoutError")).mockRejectedValueOnce(new Error("offline")); vi.stubGlobal("fetch", fetch);
  await expect(requestLogout()).rejects.toThrow("尚未确认退出");
});
it("translates an unconfirmed browser network failure into a clear retry message", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(Response.json({ user: { id: "still-active" } })); vi.stubGlobal("fetch", fetch);
  await expect(requestLogout()).rejects.toThrow("无法确认退出登录，请检查网络后重试");
});
