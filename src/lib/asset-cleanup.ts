import fs from "node:fs";
import path from "node:path";
import { sqlite } from "@/db";
import { classifyAssetCleanup, isAssetCleanupCandidate, collectDocumentAssetIds, totalAssetReferences, type AssetCleanupStatus } from "@/lib/asset-references";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AssetRow = {
  id: string;
  userId: string;
  storagePath: string;
  mimeType: string;
  originalName: string;
  size: number;
  createdAt: string;
};

type ReferenceCounts = { pages: number; snapshots: number; covers: number; trash: number };
export type AssetCandidate = {
  id: string;
  userId: string;
  username: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  uploadedAt: string;
  size: number;
  currentPageReferences: number;
  snapshotReferences: number;
  notebookCoverReferences: number;
  trashResourceReferences: number;
  referenceCount: number;
  status: AssetCleanupStatus;
  reason: string;
};

export type AssetScan = {
  summary: {
    totalImages: number;
    totalStorageBytes: number;
    referencedImages: number;
    orphanCandidates: number;
    reclaimableBytes: number;
    unknownFiles: number;
    pendingQuarantine: number;
    scanComplete: boolean;
  };
  candidates: AssetCandidate[];
  untrackedFiles: { name: string; size: number; modifiedAt: string; type: string }[];
  totalCandidates: number;
  totalCandidateBytes: number;
  totalItems: number;
  graceHours: number;
};

function gracePeriodHours() {
  const raw = process.env.ASSET_CLEANUP_GRACE_HOURS;
  if (raw === undefined || raw === "") return 48;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 8760) {
    throw new Error("ASSET_CLEANUP_GRACE_HOURS must be an integer from 1 to 8760.");
  }
  return value;
}

function uploadRoot() {
  return path.resolve(process.cwd(), "data/uploads/notes");
}

function assertManagedUploadRoot(root: string) {
  const expected = path.join(fs.realpathSync(process.cwd()), "data/uploads/notes");
  const actual = fs.realpathSync(root);
  const stat = fs.lstatSync(root);
  if (actual !== expected || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("图片目录不安全，已停止扫描或清理");
  }
}

function getReferenceCounts() {
  const counts = new Map<string, ReferenceCounts>();
  let ambiguous = false;
  const addDocuments = (query: string, field: "pages" | "snapshots") => {
    const iterator = sqlite.prepare(query).iterate() as IterableIterator<{ content: string; trashed?: number }>;
    for (const row of iterator) {
      const result = collectDocumentAssetIds([row.content]);
      ambiguous ||= result.ambiguous;
      for (const id of result.ids) {
        const current = counts.get(id) ?? { pages: 0, snapshots: 0, covers: 0, trash: 0 };
        const referenceType = field === "pages" && row.trashed ? "trash" : field;
        current[referenceType] += 1;
        counts.set(id, current);
      }
    }
  };
  addDocuments(`
    SELECT pages.content, (pages.deleted_at IS NOT NULL OR notebooks.deleted_at IS NOT NULL) AS trashed
    FROM pages INNER JOIN notebooks ON notebooks.id = pages.notebook_id
  `, "pages");
  addDocuments("SELECT content FROM note_snapshots", "snapshots");
  addDocuments("SELECT content, (deleted_at IS NOT NULL) AS trashed FROM knowledge_entries", "pages");
  const covers = sqlite.prepare(`
    SELECT cover_asset_id AS id, (deleted_at IS NOT NULL) AS trashed
    FROM notebooks WHERE cover_asset_id IS NOT NULL
  `).iterate() as IterableIterator<{ id: string; trashed: number }>;
  for (const { id, trashed } of covers) {
    const current = counts.get(id) ?? { pages: 0, snapshots: 0, covers: 0, trash: 0 };
    current[trashed ? "trash" : "covers"] += 1;
    counts.set(id, current);
  }
  return { counts, ambiguous };
}

function managedFilePath(root: string, row: Pick<AssetRow, "id" | "storagePath">) {
  if (!uuidPattern.test(row.id) || path.basename(row.storagePath) !== row.storagePath ||
      !new RegExp(`^${row.id}\\.(?:jpe?g|png|webp|gif)$`, "i").test(row.storagePath)) return null;
  const resolved = path.resolve(root, row.storagePath);
  return path.dirname(resolved) === root ? resolved : null;
}

function getDirectoryEntries(directoryPath: string) {
  const entries: { name: string; type: "file" | "directory" | "symlink" | "other" }[] = [];
  if (!fs.existsSync(directoryPath)) return entries;
  const directory = fs.opendirSync(directoryPath);
  try {
    let entry = directory.readSync();
    while (entry) {
      entries.push({
        name: entry.name,
        type: entry.isSymbolicLink() ? "symlink" : entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other"
      });
      entry = directory.readSync();
    }
  } finally {
    directory.closeSync();
  }
  return entries;
}

function scanQuarantine(root: string) {
  const trashPath = path.join(root, ".trash");
  try {
    const stat = fs.lstatSync(trashPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return 1;
    return getDirectoryEntries(trashPath).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export function scanAssetInventory({
  offset = 0,
  limit = 50,
  userId,
  sortBy = "uploadedAt",
  direction = "desc",
  onlyOrphans = false,
  now = Date.now()
}: {
  offset?: number;
  limit?: number;
  userId?: string;
  sortBy?: "uploadedAt" | "size" | "username";
  direction?: "asc" | "desc";
  onlyOrphans?: boolean;
  now?: number;
} = {}): AssetScan {
  const root = uploadRoot();
  assertManagedUploadRoot(root);
  const { counts: references, ambiguous } = getReferenceCounts();
  const ownerRows = sqlite.prepare("SELECT id, username FROM users").iterate() as IterableIterator<{ id: string; username: string }>;
  const owners = new Map<string, string>();
  for (const owner of ownerRows) owners.set(owner.id, owner.username);
  const rows = sqlite.prepare(`
    SELECT id, user_id AS userId, storage_path AS storagePath, mime_type AS mimeType,
           original_name AS originalName, size, created_at AS createdAt
    FROM assets
  `).iterate() as IterableIterator<AssetRow>;
  const registeredFiles = new Set<string>();
  const matching: AssetCandidate[] = [];
  let filteredCandidateCount = 0;
  let filteredCandidateBytes = 0;
  let filteredItemCount = 0;
  let totalImages = 0;
  let totalStorageBytes = 0;
  let referencedImages = 0;
  let orphanCandidates = 0;
  let reclaimableBytes = 0;
  const graceHours = gracePeriodHours();
  const graceMilliseconds = graceHours * 60 * 60 * 1000;
  const maxStored = offset + limit;
  const compareCandidates = (a: AssetCandidate, b: AssetCandidate) => {
    const sortFactor = direction === "asc" ? 1 : -1;
    if (sortBy === "size") return (a.size - b.size) * sortFactor;
    if (sortBy === "username") return a.username.localeCompare(b.username, "zh-CN") * sortFactor;
    return a.uploadedAt.localeCompare(b.uploadedAt) * sortFactor;
  };

  for (const row of rows) {
    totalImages += 1;
    totalStorageBytes += row.size;
    const refs = references.get(row.id);
    const referenceCount = totalAssetReferences(refs);
    if (referenceCount) referencedImages += 1;
    const filePath = managedFilePath(root, row);
    if (filePath) registeredFiles.add(row.storagePath);
    let fileState: "file" | "missing" | "unsafe" = "unsafe";
    if (filePath) {
      try {
        const stat = fs.lstatSync(filePath);
        if (stat.isFile() && !stat.isSymbolicLink()) fileState = "file";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") fileState = "missing";
        else throw error;
      }
    }
    const assessment = classifyAssetCleanup({
      referenceCount, ambiguousReferences: ambiguous, safePath: Boolean(filePath),
      fileState, createdAt: row.createdAt, now, graceMilliseconds
    });
    const { status, reason } = assessment;
    if (isAssetCleanupCandidate(status)) {
      orphanCandidates += 1;
      if (status === "orphan") reclaimableBytes += row.size;
    }
    if ((!userId || row.userId === userId) && (!onlyOrphans || isAssetCleanupCandidate(status))) {
      filteredItemCount += 1;
      if (isAssetCleanupCandidate(status)) {
        filteredCandidateCount += 1;
        if (status === "orphan") filteredCandidateBytes += row.size;
      }
      matching.push({
        id: row.id, userId: row.userId, username: owners.get(row.userId) ?? "未知用户",
        fileName: row.storagePath, originalName: row.originalName, mimeType: row.mimeType,
        uploadedAt: row.createdAt, size: row.size,
        currentPageReferences: refs?.pages ?? 0,
        snapshotReferences: refs?.snapshots ?? 0,
        notebookCoverReferences: refs?.covers ?? 0,
        trashResourceReferences: refs?.trash ?? 0,
        referenceCount, status, reason
      });
      matching.sort(compareCandidates);
      if (matching.length > maxStored) matching.pop();
    }
  }

  const entries = getDirectoryEntries(root);
  const unknownEntries = entries.filter((entry) => entry.name !== ".trash" &&
    (entry.type === "symlink" || entry.type === "file" && !registeredFiles.has(entry.name)));
  const untrackedFiles = unknownEntries.slice(0, 100).map((entry) => {
    const stat = fs.lstatSync(path.join(root, entry.name));
    return { name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), type: entry.type };
  });
  return {
    summary: {
      totalImages, totalStorageBytes, referencedImages, orphanCandidates, reclaimableBytes,
      unknownFiles: unknownEntries.length, pendingQuarantine: scanQuarantine(root), scanComplete: !ambiguous
    },
    candidates: matching.slice(offset, offset + limit),
    untrackedFiles,
    totalCandidates: filteredCandidateCount,
    totalCandidateBytes: filteredCandidateBytes,
    totalItems: filteredItemCount,
    graceHours
  };
}

function recoverQuarantinedFiles(root: string) {
  const trashPath = path.join(root, ".trash");
  try {
    const trashStat = fs.lstatSync(trashPath);
    if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) throw new Error("图片隔离目录不安全，已停止清理");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: 0, restored: 0, failed: [] as string[] };
    throw error;
  }
  let removed = 0;
  let restored = 0;
  const failed: string[] = [];
  for (const entry of getDirectoryEntries(trashPath)) {
    const match = /^([0-9a-f-]{36})--([0-9a-f-]{36})\.pending$/i.exec(entry.name);
    if (!match || entry.type !== "file" || !uuidPattern.test(match[1])) {
      failed.push(entry.name);
      continue;
    }
    const trashFile = path.join(trashPath, entry.name);
    const storedPath = sqlite.prepare("SELECT storage_path AS storagePath FROM assets WHERE id = ?").get(match[1]) as { storagePath: string } | undefined;
    try {
      const stat = fs.lstatSync(trashFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        failed.push(entry.name);
        continue;
      }
      if (storedPath) {
        const original = managedFilePath(root, { id: match[1], storagePath: storedPath.storagePath });
        if (!original || fs.existsSync(/*turbopackIgnore: true*/ original)) {
          failed.push(entry.name);
          continue;
        }
        fs.renameSync(trashFile, original);
        restored += 1;
      } else {
        fs.unlinkSync(trashFile);
        removed += 1;
      }
    } catch {
      failed.push(entry.name);
    }
  }
  return { removed, restored, failed };
}

export function cleanupOrphanAssets(adminUserId: string, assetIds: string[]) {
  const root = uploadRoot();
  fs.mkdirSync(root, { recursive: true });
  assertManagedUploadRoot(root);
  const trashPath = path.join(root, ".trash");
  const failures: { id: string; error: string }[] = [];
  let recovered = { removed: 0, restored: 0, failed: [] as string[] };
  let auditId = "";
  const now = Date.now();
  const graceMilliseconds = gracePeriodHours() * 60 * 60 * 1000;
  const selectAsset = sqlite.prepare(`
    SELECT id, user_id AS userId, storage_path AS storagePath, size, created_at AS createdAt
    FROM assets WHERE id = ?
  `);
  const deleteAsset = sqlite.prepare("DELETE FROM assets WHERE id = ?");
  const insertAudit = sqlite.prepare("INSERT INTO admin_audit_logs (id, admin_user_id, action, target_user_id, created_at) VALUES (?, ?, ?, NULL, ?)");
  const moved: { id: string; size: number; source: string; destination: string }[] = [];
  let deleted = 0;
  let deletedBytes = 0;
  let missingRecords = 0;

  try {
    sqlite.transaction(() => {
      recovered = recoverQuarantinedFiles(root);
      const referenceScan = getReferenceCounts();
      if (referenceScan.ambiguous && assetIds.length) {
        throw new Error("存在无法解析的笔记或历史版本，已停止所有图片清理");
      }
      for (const id of new Set(assetIds)) {
        if (!uuidPattern.test(id)) {
          failures.push({ id, error: "图片 ID 无效" });
          continue;
        }
        const row = selectAsset.get(id) as Pick<AssetRow, "id" | "userId" | "storagePath" | "size" | "createdAt"> | undefined;
        if (!row) {
          failures.push({ id, error: "图片记录不存在或已处理" });
          continue;
        }
        const source = managedFilePath(root, row);
        let fileState: "file" | "missing" | "unsafe" = "unsafe";
        if (source) {
          try {
            const stat = fs.lstatSync(source);
            if (stat.isFile() && !stat.isSymbolicLink()) fileState = "file";
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") fileState = "missing";
            else throw error;
          }
        }
        const refs = referenceScan.counts.get(row.id);
        const referenceCount = totalAssetReferences(refs);
        const assessment = classifyAssetCleanup({
          referenceCount, ambiguousReferences: referenceScan.ambiguous, safePath: Boolean(source),
          fileState, createdAt: row.createdAt, now, graceMilliseconds
        });
        if (!source || !isAssetCleanupCandidate(assessment.status)) {
          failures.push({ id, error: assessment.reason });
          continue;
        }
        if (assessment.status === "file-missing") {
          // No file to quarantine. The same immediate transaction has rechecked
          // every reference, so only remove this confirmed missing DB record.
          const result = deleteAsset.run(row.id);
          if (result.changes === 1) { deleted++; missingRecords++; }
          else failures.push({ id, error: "数据库记录已变化，未清理" });
          continue;
        }
        fs.mkdirSync(trashPath, { recursive: true });
        const trashStat = fs.lstatSync(trashPath);
        if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) throw new Error("图片隔离目录不安全，已停止清理");
        const destination = path.join(trashPath, `${row.id}--${crypto.randomUUID()}.pending`);
        fs.renameSync(source, destination);
        moved.push({ id: row.id, size: row.size, source, destination });
        const result = deleteAsset.run(row.id);
        if (result.changes !== 1) {
          fs.renameSync(destination, source);
          moved.pop();
          failures.push({ id, error: "数据库记录已变化，未删除图片" });
          continue;
        }
        deleted += 1;
        deletedBytes += row.size;
      }
      auditId = crypto.randomUUID();
      const action = `asset.cleanup ${JSON.stringify({ requested: assetIds.length, deleted, missingRecords, bytes: deletedBytes, failed: failures.length })}`;
      insertAudit.run(auditId, adminUserId, action, new Date(now).toISOString());
    }).immediate();
  } catch (error) {
    for (const item of moved.reverse()) {
      try {
        if (fs.existsSync(item.destination) && !fs.existsSync(item.source)) fs.renameSync(item.destination, item.source);
      } catch {
        failures.push({ id: path.basename(item.source).split(".")[0], error: "回滚失败，图片仍保留在隔离目录中以便恢复" });
      }
    }
    throw error;
  }

  let reclaimedBytes = 0;
  let reclaimedFiles = 0;
  for (const item of moved) {
    try {
      const stat = fs.lstatSync(item.destination);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("隔离文件不安全，已保留");
      fs.unlinkSync(item.destination);
      reclaimedBytes += item.size;
      reclaimedFiles += 1;
    } catch (error) {
      failures.push({ id: item.id, error: error instanceof Error ? error.message : "隔离文件删除失败，可重试" });
    }
  }
  const finalAudit = `asset.cleanup ${JSON.stringify({
    requested: assetIds.length, deleted, missingRecords, bytes: deletedBytes, reclaimedBytes,
    failed: failures.length, pendingQuarantine: moved.length - reclaimedFiles,
    recovery: recovered
  })}`;
  sqlite.prepare("UPDATE admin_audit_logs SET action = ? WHERE id = ?").run(finalAudit, auditId);
  return { deleted, deletedBytes, missingRecords, reclaimedBytes, failures, recovery: recovered };
}
