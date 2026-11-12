import { z } from "zod";

export const notebookPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  folderId: z.string().uuid().optional(),
  coverAssetId: z.string().uuid().nullable().optional()
});
