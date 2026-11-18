import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { collectDocumentAssetIds } from "@/lib/asset-references";

export class UserDeletionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

type Asset = { id: string; storagePath: string };
const managedName = /^[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)$/i;

/** Quarantine files before cascading DB deletion; rollback restores them.
 * Pending files use the storage cleanup's recoverable .trash naming convention. */
export function deleteManagedUser(sqlite: Database.Database, uploadRoot: string, adminId: string, userId: string) {
  const moved: { source: string; destination: string }[] = [];
  let missingFiles = 0;
  let assetCount = 0;
  const auditId = randomUUID();
  let username = "";
  try {
    sqlite.transaction(() => {
      const user = sqlite.prepare("SELECT username FROM users WHERE id = ? AND role = 'USER'").get(userId) as { username: string } | undefined;
      if (!user || userId === adminId) throw new UserDeletionError("普通用户不存在", 404);
      username = user.username;
      const assets = sqlite.prepare("SELECT id, storage_path AS storagePath FROM assets WHERE user_id = ?").all(userId) as Asset[];
      assetCount = assets.length;
      const ownedIds = new Set(assets.map((asset) => asset.id));
      if (assets.length) {
        const foreignDocs = sqlite.prepare("SELECT content FROM pages WHERE user_id != ? UNION ALL SELECT content FROM note_snapshots WHERE user_id != ? UNION ALL SELECT content FROM knowledge_entries WHERE user_id != ?").iterate(userId, userId, userId) as IterableIterator<{ content: string }>;
        const references = collectDocumentAssetIds((function* () { for (const row of foreignDocs) yield row.content; })());
        const covers = sqlite.prepare("SELECT cover_asset_id AS id FROM notebooks WHERE user_id != ? AND cover_asset_id IS NOT NULL").all(userId) as { id: string }[];
        if (references.ambiguous || [...references.ids, ...covers.map((row) => row.id)].some((id) => ownedIds.has(id))) {
          throw new UserDeletionError("其他账号存在无法确认或交叉引用的图片，请先检查后再删除用户", 409);
        }
        const root = path.resolve(uploadRoot);
        const stat = fs.lstatSync(root);
        if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(root) !== root) throw new UserDeletionError("图片目录不安全，未删除用户", 409);
        const trash = path.join(root, ".trash");
        fs.mkdirSync(trash, { recursive: true });
        const trashStat = fs.lstatSync(trash);
        if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) throw new UserDeletionError("图片隔离目录不安全，未删除用户", 409);
        for (const asset of assets) {
          if (!managedName.test(asset.storagePath) || path.basename(asset.storagePath) !== asset.storagePath || !asset.storagePath.toLowerCase().startsWith(`${asset.id.toLowerCase()}.`)) {
            throw new UserDeletionError("图片路径不安全，未删除用户", 409);
          }
          const source = path.join(root, asset.storagePath);
          let file: fs.Stats;
          try { file = fs.lstatSync(source); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { missingFiles++; continue; } throw error; }
          if (!file.isFile() || file.isSymbolicLink()) throw new UserDeletionError("图片文件不安全，未删除用户", 409);
          const destination = path.join(trash, `${asset.id}--${randomUUID()}.pending`);
          fs.renameSync(source, destination);
          moved.push({ source, destination });
        }
      }
      const result = sqlite.prepare("DELETE FROM users WHERE id = ? AND role = 'USER'").run(userId);
      if (result.changes !== 1) throw new UserDeletionError("用户已发生变化，请刷新后重试", 409);
      sqlite.prepare("INSERT INTO admin_audit_logs (id, admin_user_id, action, target_user_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(auditId, adminId, `user.delete ${JSON.stringify({ username, assets: assetCount, missingFiles, pendingFiles: moved.length })}`, userId, new Date().toISOString());
    }).immediate();
  } catch (error) {
    for (const item of moved.reverse()) {
      try { if (fs.existsSync(item.destination) && !fs.existsSync(item.source)) fs.renameSync(item.destination, item.source); }
      catch { console.error("User deletion rollback left a recoverable quarantined file"); }
    }
    throw error;
  }
  let pendingFiles = 0;
  for (const item of moved) {
    try {
      const file = fs.lstatSync(item.destination);
      if (!file.isFile() || file.isSymbolicLink()) throw new Error("Unsafe quarantine file");
      fs.unlinkSync(item.destination);
    } catch { pendingFiles++; }
  }
  try {
    sqlite.prepare("UPDATE admin_audit_logs SET action = ? WHERE id = ?")
      .run(`user.delete ${JSON.stringify({ username, assets: assetCount, missingFiles, pendingFiles })}`, auditId);
  } catch { console.error("User deleted; initial audit record retained with conservative pending-file count"); }
  return { ok: true, deletedAssets: assetCount, missingFiles, pendingFiles };
}
