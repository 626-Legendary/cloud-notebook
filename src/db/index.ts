import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

const configuredPath = process.env.DATABASE_URL ?? "./data/cloud-notebook.db";
const databasePath = configuredPath.startsWith("file:")
  ? configuredPath.slice(5)
  : configuredPath;
const resolvedPath = path.isAbsolute(databasePath)
  ? databasePath
  : path.join(/*turbopackIgnore: true*/ process.cwd(), databasePath);
export const databaseFile = resolvedPath;

fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
fs.mkdirSync(path.resolve(process.cwd(), "data/uploads/notes"), { recursive: true });
fs.mkdirSync(path.resolve(process.cwd(), "data/backups"), { recursive: true });

const sqlite = new Database(resolvedPath);
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { sqlite };
export function nowIso() {
  return new Date().toISOString();
}
