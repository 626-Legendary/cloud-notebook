import path from "node:path";
import yauzl from "yauzl";

export async function readZipEntries(buffer: Buffer, maxEntryBytes: number, maxTotalBytes: number, maxEntries = 100_000) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error("无法打开 ZIP 文件"));
        return;
      }
      const entries = new Map<string, Buffer>();
      let totalBytes = 0;
      let entryCount = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(entries);
      });
      zip.on("entry", (entry) => {
        const name = entry.fileName;
        const normalized = path.posix.normalize(name);
        if (
          !name || name.includes("\\") || name.includes("\0") || path.posix.isAbsolute(name) ||
          normalized === ".." || normalized.startsWith("../") || (normalized !== name.replace(/\/$/, "") && normalized !== name)
        ) {
          fail(new Error("ZIP 内含不安全的文件路径"));
          return;
        }
        if (++entryCount > maxEntries || (entry.generalPurposeBitFlag & 1) || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
          fail(new Error("ZIP 条目过多或包含加密／链接文件")); return;
        }
        if (name.endsWith("/")) { zip.readEntry(); return; }
        if (entries.has(name) || entry.uncompressedSize > maxEntryBytes) {
          fail(new Error("ZIP 文件包含重复条目或过大的文件"));
          return;
        }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > maxTotalBytes) {
          fail(new Error("ZIP 解压后体积超过允许上限"));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error("无法读取 ZIP 文件"));
            return;
          }
          const chunks: Buffer[] = [];
          let actualBytes = 0;
          stream.on("data", (chunk: Buffer) => {
            actualBytes += chunk.length;
            if (actualBytes > maxEntryBytes || totalBytes - entry.uncompressedSize + actualBytes > maxTotalBytes) {
              stream.destroy(new Error("ZIP 解压后体积超过允许上限"));
              return;
            }
            chunks.push(chunk);
          });
          stream.on("error", fail);
          stream.on("end", () => {
            if (settled) return;
            entries.set(name, Buffer.concat(chunks, actualBytes));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
