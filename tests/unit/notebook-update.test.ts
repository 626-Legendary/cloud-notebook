import { describe, expect, it } from "vitest";
import { notebookPatchSchema } from "@/lib/notebook-update";

describe("notebook cover updates", () => {
  it("distinguishes an omitted cover from an explicit removal", () => {
    const coverId = "5e3f1a70-63bd-4a0e-8c1c-c685bbf7b75f";
    expect(notebookPatchSchema.parse({ title: "Research" })).toEqual({ title: "Research" });
    expect(notebookPatchSchema.parse({ coverAssetId: null })).toEqual({ coverAssetId: null });
    expect(notebookPatchSchema.parse({ coverAssetId: coverId })).toEqual({ coverAssetId: coverId });
  });
});
