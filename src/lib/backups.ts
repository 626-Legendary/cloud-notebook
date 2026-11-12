import archiver from "archiver";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { db, sqlite, nowIso } from "@/db";
import { backupRecords } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function createSystemBackup() {
  const configuredDirectory = process.env.BACKUP_DIRECTORY ?? "./data/backups";
  const directory = path.isAbsolute(configuredDirectory)
    ? configuredDirectory
    : path.join(/*turbopackIgnore: true*/ process.cwd(), configuredDirectory);
  await fsp.mkdir(directory, { recursive: true });
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), "cloud-notebook-backup-"));
  const databaseCopy = path.join(staging, "cloud-notebook.db");
  const filename = `cloud-notebook-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const finalPath = path.join(directory, filename);
  const temporaryZip = `${finalPath}.tmp`;
  try {
    await sqlite.backup(databaseCopy);
    const archive = archiver("zip", { zlib: { level: 6 } });
    const output = fs.createWriteStream(temporaryZip, { mode: 0o600 });
    const completed = pipeline(archive, output);
    archive.file(databaseCopy, { name: "cloud-notebook.db" });
    archive.directory(path.resolve(process.cwd(), "data/uploads"), "uploads");
    archive.append(JSON.stringify({ formatVersion: 1, createdAt: nowIso() }, null, 2), { name: "manifest.json" });
    await archive.finalize();
    await completed;
    await fsp.rename(temporaryZip, finalPath);
    const hash = createHash("sha256");
    await pipeline(fs.createReadStream(finalPath), hash);
    const stat = await fsp.stat(finalPath);
    const record = {
      id: crypto.randomUUID(), filename, storagePath: finalPath, size: stat.size,
      checksum: hash.digest("hex"), status: "completed", createdAt: nowIso()
    };
    await db.insert(backupRecords).values(record);
    return record;
  } catch (error) {
    await fsp.rm(temporaryZip, { force: true });
    throw error;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

export async function applyBackupRetention() {
  const dailyLimit = Math.max(1, Number(process.env.BACKUP_RETENTION_DAILY ?? 7));
  const weeklyLimit = Math.max(1, Number(process.env.BACKUP_RETENTION_WEEKLY ?? 4));
  const rows = await db.select().from(backupRecords).orderBy(backupRecords.createdAt);
  const keep = new Set<string>();
  const dailyDays = new Set<string>();
  const dailyWeeks = new Set<string>();
  let olderWeeks = 0;
  for (const row of rows.reverse()) {
    const day = new Date(row.createdAt).toISOString().slice(0, 10);
    const ageDays = (Date.now() - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
    if (ageDays <= dailyLimit && dailyDays.size < dailyLimit && !dailyDays.has(day)) {
      keep.add(row.id);
      dailyDays.add(day);
      continue;
    }
    const date = new Date(row.createdAt);
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7)));
    const week = monday.toISOString().slice(0, 10);
    if (olderWeeks < weeklyLimit && !dailyWeeks.has(week)) {
      keep.add(row.id);
      dailyWeeks.add(week);
      olderWeeks += 1;
    }
  }
  for (const row of rows) {
    if (keep.has(row.id)) continue;
    await fsp.rm(row.storagePath, { force: true });
    await db.delete(backupRecords).where(eq(backupRecords.id, row.id));
  }
}

export async function scheduleBackups() {
  if (process.env.BACKUP_ENABLED === "false") return;
  const run = async () => {
    try {
      const latest = (await db.select().from(backupRecords).orderBy(backupRecords.createdAt).limit(1))[0];
      if (!latest || Date.now() - Date.parse(latest.createdAt) >= 24 * 60 * 60_000) {
        await createSystemBackup();
        await applyBackupRetention();
      }
    } catch (error) {
      console.error("Scheduled backup failed", error);
    }
  };
  setTimeout(() => { void run(); }, 60_000);
  setInterval(() => { void run(); }, 60 * 60_000).unref();
}
