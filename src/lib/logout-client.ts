/** Resolve uncertain network outcomes using a fresh server session check.
 * Never claim logout succeeded just because the original request timed out. */
export async function requestLogout() {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(result.error ?? "退出登录失败，请重试");
  } catch (error) {
    try {
      const session = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(3_000) });
      if (session.status === 401) return;
    } catch { /* Keep the failure visible if server state cannot be confirmed. */ }
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("服务器响应较慢，尚未确认退出，请重试");
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error("无法确认退出登录，请检查网络后重试");
    throw error instanceof Error ? error : new Error("退出登录失败，请重试");
  }
}
