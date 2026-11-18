import { sqlite } from "@/db";

const batchSize = 500;
let maintenanceRunning = false;

export function purgeExpiredSnapshots(now = Date.now()) {
  if (maintenanceRunning) return 0;
  maintenanceRunning = true;
  try {
    const cutoff = new Date(now - 24 * 60 * 60_000).toISOString();
    const removeBatch = sqlite.prepare(`
      DELETE FROM note_snapshots
      WHERE id IN (
        SELECT id FROM note_snapshots
        WHERE created_at < ?
        ORDER BY created_at
        LIMIT ?
      )
    `);
    let removed = 0;
    while (true) {
      const result = sqlite.transaction(() => removeBatch.run(cutoff, batchSize)).immediate();
      removed += result.changes;
      if (result.changes < batchSize) return removed;
    }
  } finally {
    maintenanceRunning = false;
  }
}

export function purgeExpiredTrash(now = Date.now()) {
  if (maintenanceRunning) return 0;
  maintenanceRunning = true;
  try {
    const cutoff = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
    const removePages = sqlite.prepare(`
      DELETE FROM pages
      WHERE id IN (
        SELECT id FROM pages
        WHERE deleted_at IS NOT NULL AND deleted_at < ?
        ORDER BY deleted_at
        LIMIT ?
      )
    `);
    const removeNotebooks = sqlite.prepare(`
      DELETE FROM notebooks
      WHERE id IN (
        SELECT id FROM notebooks
        WHERE deleted_at IS NOT NULL AND deleted_at < ?
        ORDER BY deleted_at
        LIMIT ?
      )
    `);
    let removed = 0;
    while (true) {
      const result = sqlite.transaction(() => {
        const pagesResult = removePages.run(cutoff, batchSize);
        const notebooksResult = removeNotebooks.run(cutoff, batchSize);
        const entriesResult = sqlite.prepare("DELETE FROM knowledge_entries WHERE id IN (SELECT id FROM knowledge_entries WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?)").run(cutoff, batchSize);
        return pagesResult.changes + notebooksResult.changes + entriesResult.changes;
      }).immediate();
      removed += result;
      if (result < batchSize) return removed;
    }
  } finally {
    maintenanceRunning = false;
  }
}

export function scheduleMaintenance() {
  const run = () => {
    try {
      const snapshots = purgeExpiredSnapshots();
      const trash = purgeExpiredTrash();
      if (snapshots) console.info(`Snapshot retention removed ${snapshots} expired snapshots.`);
      if (trash) console.info(`Trash retention permanently removed ${trash} expired items.`);
    } catch (error) {
      console.error("Snapshot retention cleanup failed", error);
    }
  };
  setTimeout(run, 10_000);
  setInterval(run, 60 * 60_000).unref();
}
