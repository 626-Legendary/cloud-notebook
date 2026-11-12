import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { folders, notebooks, pages } from "@/db/schema";
import { authError, requireUser } from "@/lib/auth";
import { createSearchSnippet, extractSearchableText } from "@/lib/search-text";
import { jsonError } from "@/lib/http";

const querySchema = z.string().trim().min(1).max(100);

export async function GET(request: Request) {
  try {
    const { userId } = await requireUser();
    const query = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
    if (!query.success) return Response.json({ results: [] });
    const needle = query.data.toLocaleLowerCase();
    const [userFolders, userNotebooks, userPages] = await Promise.all([
      db.select({ id: folders.id, name: folders.name })
        .from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.sortOrder)),
      db.select({
        id: notebooks.id, title: notebooks.title, folderId: notebooks.folderId,
        folderName: folders.name, updatedAt: notebooks.updatedAt
      }).from(notebooks).innerJoin(folders, eq(notebooks.folderId, folders.id))
        .where(and(eq(notebooks.userId, userId), isNull(notebooks.deletedAt))),
      db.select({
        id: pages.id, notebookId: pages.notebookId, title: pages.title, content: pages.content,
        updatedAt: pages.updatedAt, notebookTitle: notebooks.title, folderId: notebooks.folderId,
        folderName: folders.name
      }).from(pages).innerJoin(notebooks, eq(pages.notebookId, notebooks.id))
        .innerJoin(folders, eq(notebooks.folderId, folders.id))
        .where(and(eq(pages.userId, userId), isNull(pages.deletedAt), isNull(notebooks.deletedAt)))
    ]);
    const results = [
      ...userFolders.filter((folder) => folder.name.toLocaleLowerCase().includes(needle)).map((folder) => ({
        id: folder.id, type: "folder" as const, title: folder.name, folderId: folder.id,
        folderName: folder.name, notebookTitle: "", pageId: "", notebookId: "", summary: "", updatedAt: ""
      })),
      ...userNotebooks.filter((notebook) => notebook.title.toLocaleLowerCase().includes(needle)).map((notebook) => ({
        id: notebook.id, type: "notebook" as const, title: notebook.title, folderId: notebook.folderId,
        folderName: notebook.folderName, notebookTitle: notebook.title, pageId: "", notebookId: notebook.id,
        summary: "", updatedAt: notebook.updatedAt
      })),
      ...userPages.flatMap((page) => {
        const body = extractSearchableText(page.content);
        const bodyMatch = body.toLocaleLowerCase().includes(needle);
        const titleMatch = page.title.toLocaleLowerCase().includes(needle);
        if (!bodyMatch && !titleMatch) return [];
        return [{
          id: page.id, type: "page" as const, title: page.title, folderId: page.folderId,
          folderName: page.folderName, notebookTitle: page.notebookTitle, notebookId: page.notebookId,
          pageId: page.id, summary: bodyMatch ? createSearchSnippet(body, query.data) : "",
          updatedAt: page.updatedAt
        }];
      })
    ].slice(0, 100);
    return Response.json({ results });
  } catch (error) {
    return jsonError("无法搜索笔记", authError(error));
  }
}
