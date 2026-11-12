import { normalizeAutoSaveMode } from "@/lib/auto-save";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso } from "@/db";
import { userSettings, users } from "@/db/schema";
import { authError, requireAdmin, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { getRegistrationEnabled, setRegistrationEnabled } from "@/lib/system-settings";

const schema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  autoSaveMode: z.enum(["realtime", "60s", "300s", "600s", "off", "10s", "30s"]).optional(),
  sidebarCollapsed: z.boolean().optional(),
  registrationEnabled: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0);

export async function GET() {
  try {
    const { userId } = await requireUser();
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const [user] = await db.select({ username: users.username, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
    const registrationEnabled = await getRegistrationEnabled();
    return Response.json({ settings: settings ? { ...settings, autoSaveMode: normalizeAutoSaveMode(settings.autoSaveMode) } : settings, user, registrationEnabled });
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

export async function PATCH(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("设置内容无效");
    const { registrationEnabled, ...settingsPatch } = parsed.data;
    if (settingsPatch.autoSaveMode) settingsPatch.autoSaveMode = normalizeAutoSaveMode(settingsPatch.autoSaveMode) as typeof settingsPatch.autoSaveMode;
    const caller = registrationEnabled !== undefined ? await requireAdmin() : await requireUser();
    const [updated] = await db.update(userSettings).set({ ...settingsPatch, updatedAt: nowIso() }).where(eq(userSettings.userId, caller.userId)).returning();
    const effectiveRegistration = registrationEnabled !== undefined ? await setRegistrationEnabled(registrationEnabled) : await getRegistrationEnabled();
    return Response.json({ settings: updated ? { ...updated, autoSaveMode: normalizeAutoSaveMode(updated.autoSaveMode) } : updated, registrationEnabled: effectiveRegistration });
  } catch (error) { return jsonError("无法保存设置", authError(error)); }
}
