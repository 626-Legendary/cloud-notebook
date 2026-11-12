import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZipEntries } from "@/lib/zip-reader";

function zipSingleEntry(name: string, content: Buffer) {
  const nameBytes = Buffer.from(name);
  const compressed = deflateRawSync(content);
  const crc = crc32(content);
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let checksum = value;
  for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
  return checksum >>> 0;
});

function crc32(content: Buffer) {
  let checksum = 0xffffffff;
  for (const byte of content) checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 0xff];
  return (checksum ^ 0xffffffff) >>> 0;
}

describe("ZIP entry reader", () => {
  it("accepts image-sized entries while enforcing the configured bounds", async () => {
    const image = Buffer.alloc(2 * 1024 * 1024 + 1, 0x5a);
    const archive = await zipSingleEntry("assets/large-image.webp", image);
    const entries = await readZipEntries(archive, 10 * 1024 * 1024, 10 * 1024 * 1024);
    const restored = entries.get("assets/large-image.webp");
    expect(restored).toHaveLength(image.length);
    expect(restored?.[0]).toBe(0x5a);
    expect(restored?.at(-1)).toBe(0x5a);
    await expect(readZipEntries(archive, 2 * 1024 * 1024, 10 * 1024 * 1024)).rejects.toThrow("过大的文件");
  });
  it("rejects traversal paths, encrypted/link entries, entry count and aggregate expansion excess", async () => {
    for (const name of ["../escape.txt", "/absolute.txt", "assets/../../escape.txt", "assets\\escape.txt", "../"]) {
      await expect(readZipEntries(zipSingleEntry(name, Buffer.from("unsafe")), 1024, 1024)).rejects.toThrow();
    }
    const archive = zipSingleEntry("valid.txt", Buffer.alloc(100));
    await expect(readZipEntries(archive, 1024, 99)).rejects.toThrow("体积");
    await expect(readZipEntries(archive, 1024, 1024, 0)).rejects.toThrow("条目过多");
    const encrypted = Buffer.from(archive), central = encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
    encrypted.writeUInt16LE(1, 6); encrypted.writeUInt16LE(1, central + 8);
    await expect(readZipEntries(encrypted, 1024, 1024)).rejects.toThrow();
    const link = Buffer.from(archive);
    link.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
    await expect(readZipEntries(link, 1024, 1024)).rejects.toThrow("链接");
  });

});
