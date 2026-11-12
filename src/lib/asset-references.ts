const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uploadUrlPattern = /^\/uploads\/notes\/([0-9a-f-]{36})$/i;

export type AssetCleanupStatus = "orphan" | "grace-period" | "referenced" | "unknown" | "file-missing";

/** Both statuses are safe only after classifyAssetCleanup has checked all references and paths. */
export function isAssetCleanupCandidate(status: AssetCleanupStatus) {
  return status === "orphan" || status === "file-missing";
}

export function totalAssetReferences(references?: {
  pages?: number;
  snapshots?: number;
  covers?: number;
  trash?: number;
}) {
  if (!references) return 0;
  return (references.pages ?? 0) + (references.snapshots ?? 0) +
    (references.covers ?? 0) + (references.trash ?? 0);
}

export function collectDocumentAssetIds(contents: Iterable<string>) {
  const ids = new Set<string>();
  let ambiguous = false;
  for (const content of contents) {
    let root: unknown;
    try {
      root = JSON.parse(content);
    } catch {
      ambiguous = true;
      continue;
    }
    const stack: unknown[] = [root];
    while (stack.length) {
      const current = stack.pop();
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
        continue;
      }
      if (!current || typeof current !== "object") continue;
      const node = current as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown };
      if (node.type === "image" && node.attrs) {
        const assetId = node.attrs.assetId;
        if (typeof assetId === "string") {
          if (uuidPattern.test(assetId)) ids.add(assetId);
          else ambiguous = true;
        }
        const src = node.attrs.src;
        if (typeof src === "string") {
          let pathname = src;
          try { pathname = new URL(src, "http://cloud-notebook.invalid").pathname; } catch { ambiguous = true; }
          if (pathname.startsWith("/uploads/notes/")) {
            const match = uploadUrlPattern.exec(pathname);
            if (match) ids.add(match[1]);
            else ambiguous = true;
          }
        }
      }
      if (node.content !== undefined) stack.push(node.content);
    }
  }
  return { ids, ambiguous };
}

export function classifyAssetCleanup({
  referenceCount,
  ambiguousReferences,
  safePath,
  fileState,
  createdAt,
  now,
  graceMilliseconds
}: {
  referenceCount: number;
  ambiguousReferences: boolean;
  safePath: boolean;
  fileState: "file" | "missing" | "unsafe";
  createdAt: string;
  now: number;
  graceMilliseconds: number;
}): { status: AssetCleanupStatus; reason: string } {
  if (referenceCount > 0) return { status: "referenced", reason: "仍被当前笔记、历史版本、笔记本封面或垃圾箱项目引用" };
  if (ambiguousReferences) return { status: "unknown", reason: "有正文或历史版本格式无法解析，需人工检查" };
  if (!safePath || fileState === "unsafe") return { status: "unknown", reason: "无法确认安全的图片文件路径" };
  if (fileState === "missing") return { status: "file-missing", reason: "图片文件缺失且没有任何引用，可清理数据库记录，不会释放磁盘空间" };
  const uploadedAt = Date.parse(createdAt);
  if (!Number.isFinite(uploadedAt)) return { status: "unknown", reason: "上传时间无效" };
  if (now - uploadedAt < graceMilliseconds) return { status: "grace-period", reason: `仍在 ${Math.ceil(graceMilliseconds / 3_600_000)} 小时安全宽限期内` };
  return { status: "orphan", reason: "没有任何有效引用且已超过宽限期" };
}
