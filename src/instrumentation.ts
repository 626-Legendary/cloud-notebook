export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/db/migrate");
    const { initializeAdmin, validateAuthConfiguration } = await import("@/lib/auth");
    validateAuthConfiguration();
    await initializeAdmin();
    const { scheduleBackups } = await import("@/lib/backups");
    await scheduleBackups();
    const { scheduleMaintenance } = await import("@/lib/maintenance");
    scheduleMaintenance();
  }
}
