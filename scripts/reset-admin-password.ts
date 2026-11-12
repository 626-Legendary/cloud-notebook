import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());
  await import("../src/db/migrate");
  const { eq } = await import("drizzle-orm");
  const { hashPassword, initializeAdmin } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const { users } = await import("../src/db/schema");
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.NEW_ADMIN_PASSWORD ?? randomBytes(20).toString("base64url");
  if (password.length < 12 || password.length > 128) throw new Error("NEW_ADMIN_PASSWORD must be 12–128 characters.");
  await initializeAdmin();
  const [admin] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!admin || admin.role !== "ADMIN") throw new Error(`Admin account "${username}" was not initialized.`);
  await db.update(users).set({
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    sessionVersion: admin.sessionVersion + 1
  }).where(eq(users.id, admin.id));
  console.log(`Temporary password for ${username}: ${password}`);
  console.log("This password is shown only once. Sign in and choose a new password.");
}

main().catch((error: unknown) => {
  console.error("Admin password reset failed:", error);
  process.exitCode = 1;
});
