import { eq } from "drizzle-orm";
import { db, nowIso } from "@/db";
import { systemSettings } from "@/db/schema";

export function getDefaultRegistrationEnabled() {
  return process.env.ALLOW_REGISTRATION !== "false";
}

export async function ensureSystemSettings() {
  const defaults = {
    registration_enabled: String(getDefaultRegistrationEnabled())
  } as const;

  for (const [key, value] of Object.entries(defaults)) {
    const existing = await db.select({ key: systemSettings.key }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    if (existing.length) continue;
    await db.insert(systemSettings).values({ key, value, updatedAt: nowIso() });
  }
}

export async function getRegistrationEnabled() {
  await ensureSystemSettings();
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "registration_enabled")).limit(1);
  return row ? row.value !== "false" : getDefaultRegistrationEnabled();
}

export async function setRegistrationEnabled(enabled: boolean) {
  await ensureSystemSettings();
  const value = enabled ? "true" : "false";
  const [existing] = await db.select({ key: systemSettings.key }).from(systemSettings).where(eq(systemSettings.key, "registration_enabled")).limit(1);
  if (existing) {
    await db.update(systemSettings).set({ value, updatedAt: nowIso() }).where(eq(systemSettings.key, "registration_enabled"));
    return enabled;
  }
  await db.insert(systemSettings).values({ key: "registration_enabled", value, updatedAt: nowIso() });
  return enabled;
}
