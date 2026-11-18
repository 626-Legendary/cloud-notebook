import { and, asc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { PrintDocument } from "@/components/print-document";
import { db } from "@/db";
import { notebooks, pages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { resolveKnowledgeContent } from "@/lib/knowledge";
import { renderDocument } from "@/lib/render-document";

export const dynamic = "force-dynamic";

export default async function PrintNotebook({ params }: { params: Promise<{ notebookId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "USER") redirect("/login");
  const { notebookId } = await params;
  const [notebook] = await db.select().from(notebooks).where(and(
    eq(notebooks.id, notebookId), eq(notebooks.userId, session.userId), isNull(notebooks.deletedAt)
  )).limit(1);
  if (!notebook) notFound();
  const notebookPages = await db.select().from(pages).where(and(
    eq(pages.notebookId, notebookId), eq(pages.userId, session.userId), isNull(pages.deletedAt)
  )).orderBy(asc(pages.sortOrder), asc(pages.createdAt));
  return <PrintDocument><main className="prose-print">
    <h1 className="print-notebook-title">{notebook.title}</h1>
    {notebookPages.map((page) => <section className="print-page" key={page.id}>
      <h2 className="print-page-title">{page.title}</h2>
      <article>{renderDocument(resolveKnowledgeContent(session.userId, page.content))}</article>
    </section>)}
  </main></PrintDocument>;
}
