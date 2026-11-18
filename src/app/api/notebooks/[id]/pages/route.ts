import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso, sqlite } from "@/db";
import { notebooks, pages } from "@/db/schema";
import { sourceTags } from "@/lib/knowledge";
import { authError, requireUser } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";

const schema = z.object({ title: z.string().trim().min(1).max(200).optional() });
const emptyDoc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const [notebook] = await db.select({ id: notebooks.id }).from(notebooks).where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).limit(1);
    if (!notebook) return jsonError("笔记本不存在", 404);
    const pageRows = sqlite.prepare(`
      SELECT id, notebook_id AS notebookId, title, sort_order AS sortOrder, version,
             pinned_at AS pinnedAt, pin_sort_order AS pinSortOrder,
             updated_at AS updatedAt, created_at AS createdAt, content
      FROM pages WHERE notebook_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC
    `).iterate(id, userId) as IterableIterator<{
      id: string; notebookId: string; title: string; sortOrder: number; version: number; pinnedAt: string | null; pinSortOrder: number;
      updatedAt: string; createdAt: string; content: string
    }>;
    const rows: { id: string; notebookId: string; title: string; sortOrder: number; version: number; pinnedAt: string | null; pinSortOrder: number; updatedAt: string; createdAt: string; summary: string; tagIds: string[] }[] = [];
    for (const { content, ...page } of pageRows) {
      rows.push({ ...page, summary: summarize(content), tagIds: sourceTags(userId, "page", page.id).map((tag) => tag.id) });
    }
    return Response.json({ pages: rows });
  } catch (error) { return jsonError("请先登录", authError(error)); }
}

function summarize(content: string) {
  try {
    const visit = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const value = node as { text?: string; content?: unknown[]; type?: string };
      return `${value.text ?? ""}${(value.content ?? []).map(visit).join(value.type === "paragraph" ? " " : "")}`;
    };
    return visit(JSON.parse(content)).replace(/\s+/g, " ").trim().slice(0, 120);
  } catch { return ""; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(request)) return jsonError("请求来源无效", 403);
  try {
    const { userId } = await requireUser();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonError("页面标题无效");
    const [notebook] = await db.select({ id: notebooks.id }).from(notebooks).where(and(eq(notebooks.id, id), eq(notebooks.userId, userId), isNull(notebooks.deletedAt))).limit(1);
    if (!notebook) return jsonError("笔记本不存在", 404);
    const now = nowIso();
    const page = { id: crypto.randomUUID(), userId, notebookId: id, title: parsed.data.title ?? "无标题", content: emptyDoc, sortOrder: Date.now(), version: 1, createdAt: now, updatedAt: now };
    const [created] = await db.insert(pages).values(page).returning();
    return Response.json({ page: created }, { status: 201 });
  } catch (error) { return jsonError("无法创建页面", authError(error)); }
}
