import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "./index";

export function migrateDatabase() {
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS folders_single_default_idx ON folders(user_id, is_default) WHERE is_default = 1");
}

migrateDatabase();
