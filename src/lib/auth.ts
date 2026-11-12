import { cookies } from "next/headers";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db, nowIso } from "@/db";
import { authSessions, users } from "@/db/schema";
import { isSecureRequest } from "@/lib/http";

const cookieName = "cloud-notebook-session";
function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(secret);
}

export function validateAuthConfiguration() {
  secretKey();
}

export type Session = { userId: string; role: "ADMIN" | "USER"; sessionVersion: number; mustChangePassword: boolean; currentSessionId: string };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sessionDeviceLabel(userAgent: string) {
  const browser = /Edg(?:e|A|iOS)?\/([\d.]+)/i.test(userAgent) ? "Edge"
    : /Firefox\/([\d.]+)/i.test(userAgent) ? "Firefox"
      : /Chrome\/([\d.]+)/i.test(userAgent) ? "Chrome"
        : /Version\/([\d.]+).*Safari/i.test(userAgent) ? "Safari"
          : /Opera|OPR\//i.test(userAgent) ? "Opera" : "未知浏览器";
  const os = /Windows NT/i.test(userAgent) ? "Windows"
    : /Android/i.test(userAgent) ? "Android"
      : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS"
        : /Mac OS X/i.test(userAgent) ? "macOS"
          : /Linux/i.test(userAgent) ? "Linux" : "未知系统";
  return `${browser} · ${os}`;
}

export async function createSession(user: typeof users.$inferSelect, request: Request) {
  const id = randomUUID();
  const jti = randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 512);
  await db.insert(authSessions).values({
    id, userId: user.id, jtiHash: sha256(jti), userAgent,
    deviceLabel: sessionDeviceLabel(userAgent), createdAt, lastActiveAt: createdAt, expiresAt, revokedAt: null
  });
  const token = await new SignJWT({ role: user.role, sessionVersion: user.sessionVersion, sid: id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.parse(expiresAt) / 1000))
    .sign(secretKey());
  const jar = await cookies();
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });
}

export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  let sessionId: string | undefined;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secretKey());
      if (typeof payload.sid === "string") sessionId = payload.sid;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      sessionId = undefined;
    }
  }
  if (sessionId) await db.update(authSessions).set({ revokedAt: nowIso() })
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)));
  jar.delete(cookieName);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secretKey()));
  } catch {
    return null;
  }
  const userId = payload.sub;
  const sessionId = payload.sid;
  const jti = payload.jti;
  if (!userId || typeof sessionId !== "string" || typeof jti !== "string" ||
      (payload.role !== "ADMIN" && payload.role !== "USER")) return null;
  const now = nowIso();
  const [authSession] = await db.select({
    id: authSessions.id, lastActiveAt: authSessions.lastActiveAt, expiresAt: authSessions.expiresAt
  }).from(authSessions).where(and(
    eq(authSessions.id, sessionId), eq(authSessions.userId, userId),
    eq(authSessions.jtiHash, sha256(jti)), isNull(authSessions.revokedAt)
  )).limit(1);
  if (!authSession || authSession.expiresAt <= now) return null;
  if (Date.now() - Date.parse(authSession.lastActiveAt) >= 5 * 60_000) {
    await db.update(authSessions).set({ lastActiveAt: now })
      .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)));
  }
  const [user] = await db.select({
    id: users.id, role: users.role, sessionVersion: users.sessionVersion, mustChangePassword: users.mustChangePassword
  }).from(users).where(and(eq(users.id, userId), eq(users.sessionVersion, Number(payload.sessionVersion ?? -1)))).limit(1);
  if (!user) return null;
  return { userId: user.id, role: user.role, sessionVersion: user.sessionVersion, mustChangePassword: user.mustChangePassword, currentSessionId: sessionId };
}

export async function requireUser() {
  const session = await getSession();
  if (!session || session.role !== "USER") throw new Error("UNAUTHORIZED");
  if (session.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN");
  if (session.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  return session;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function initializeAdmin() {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN")).limit(1);
  if (existing) return;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password || password.length < 12) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Set ADMIN_INITIAL_PASSWORD (at least 12 characters) before starting the application.");
    }
    return;
  }
  const username = process.env.ADMIN_USERNAME ?? "admin";
  await db.insert(users).values({
    id: crypto.randomUUID(), username, passwordHash: await hashPassword(password),
    role: "ADMIN", mustChangePassword: true, sessionVersion: 0, createdAt: new Date().toISOString()
  });
}

export function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" || message === "PASSWORD_CHANGE_REQUIRED" ? 403 : 500;
}
