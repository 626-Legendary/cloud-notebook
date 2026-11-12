import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const expectedOrigins = [
      new URL(request.url).origin,
      ...(process.env.APP_URL ?? "").split(",").filter(Boolean).map((url) => new URL(url.trim()).origin)
    ];
    return expectedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProtocol || new URL(request.url).protocol.slice(0, -1);
  return protocol === "https";
}
