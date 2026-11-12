import { and, eq, isNull, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { PrintDocument } from "@/components/print-document";
import { db } from "@/db";
import { notebooks, pages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { renderDocument } from "@/lib/render-document";

export const dynamic = "force-dynamic";

export default async function PrintPage({ params }: { params: Promise<{ pageId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "USER") redirect("/login");
  const { pageId } = await params;
  const [page] = await db.select().from(pages).where(and(
    eq(pages.id, pageId), eq(pages.userId, session.userId), isNull(pages.deletedAt),
    sql`EXISTS (SELECT 1 FROM ${notebooks} WHERE ${notebooks.id} = ${pages.notebookId} AND ${notebooks.deletedAt} IS NULL)`
  )).limit(1);
  if (!page) notFound();
  return <PrintDocument><main className="prose-print">
    <h1 className="print-page-title">{page.title}</h1>
    <article>{renderDocument(page.content)}</article>
  </main></PrintDocument>;
}
