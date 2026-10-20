import { notFound, redirect } from "next/navigation";
import { getDocumentForReviewAction } from "@/modules/documents";
import { DocumentReviewClient } from "@/modules/documents/ui";

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getDocumentForReviewAction({ documentId: id });

  if (result?.data?.error?.code === "NOT_FOUND") notFound();
  if (result?.data?.error?.code === "FORBIDDEN") redirect("/documents");
  if (result?.data?.error || !result?.data?.data) redirect("/documents");

  return <DocumentReviewClient data={result.data.data} />;
}
