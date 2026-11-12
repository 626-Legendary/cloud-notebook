import { describe, expect, it } from "vitest";
import { classifyAssetCleanup, collectDocumentAssetIds, totalAssetReferences } from "@/lib/asset-references";

const assetId = "5e3f1a70-63bd-4a0e-8c1c-c685bbf7b75f";
const otherAssetId = "de3482d8-65e1-4e32-9b46-84df4e917d3f";

describe("collectDocumentAssetIds", () => {
  it("finds asset IDs in current content and old upload URLs", () => {
    const document = JSON.stringify({
      type: "doc",
      content: [
        { type: "image", attrs: { assetId, src: `/uploads/notes/${assetId}` } },
        { type: "paragraph", content: [
          { type: "image", attrs: { src: `https://example.test/uploads/notes/${otherAssetId}?width=640` } }
        ] }
      ]
    });

    expect(collectDocumentAssetIds([document])).toEqual({
      ids: new Set([assetId, otherAssetId]),
      ambiguous: false
    });
  });

  it("marks malformed documents and unmanaged image paths as ambiguous", () => {
    const result = collectDocumentAssetIds([
      "{\"type\":\"doc\"",
      JSON.stringify({ type: "image", attrs: { src: "/uploads/notes/not-a-managed-id" } })
    ]);

    expect(result.ambiguous).toBe(true);
    expect(result.ids.size).toBe(0);
  });
});

describe("classifyAssetCleanup", () => {
  const base = {
    referenceCount: 0,
    ambiguousReferences: false,
    safePath: true,
    fileState: "file" as const,
    createdAt: "2020-01-01T00:00:00.000Z",
    now: Date.parse("2020-01-05T00:00:00.000Z"),
    graceMilliseconds: 48 * 60 * 60 * 1000
  };

  it("allows only safe, unreferenced, old files to be cleaned", () => {
    expect(classifyAssetCleanup(base).status).toBe("orphan");
    expect(classifyAssetCleanup({ ...base, referenceCount: 1 }).status).toBe("referenced");
    expect(classifyAssetCleanup({ ...base, ambiguousReferences: true }).status).toBe("unknown");
    expect(classifyAssetCleanup({ ...base, safePath: false }).status).toBe("unknown");
    expect(classifyAssetCleanup({ ...base, fileState: "missing" }).status).toBe("file-missing");
  });

  it("retains recent uploads and invalid timestamps", () => {
    expect(classifyAssetCleanup({
      ...base,
      createdAt: new Date(base.now - 60 * 60 * 1000).toISOString()
    }).status).toBe("grace-period");
    expect(classifyAssetCleanup({ ...base, createdAt: "invalid" }).status).toBe("unknown");
  });
});

describe("totalAssetReferences", () => {
  it("includes every reference category, including trash resources", () => {
    expect(totalAssetReferences({ pages: 2, snapshots: 3, covers: 1, trash: 4 })).toBe(10);
    expect(totalAssetReferences({ trash: 1 })).toBe(1);
    expect(totalAssetReferences()).toBe(0);
  });
});
