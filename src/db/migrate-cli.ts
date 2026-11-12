import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());
  await import("./migrate");
  console.log("SQLite migrations applied.");
}

main().catch((error: unknown) => {
  console.error("SQLite migration failed:", error);
  process.exitCode = 1;
});
