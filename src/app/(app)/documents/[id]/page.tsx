import { notFound, redirect } from "next/navigation";
import { DocumentReviewClient } from "@/components/domain/document-review-client";
import { getDocumentForReviewAction } from "@/server/actions/documents";

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getDocumentForReviewAction({ documentId: id });

  if (result?.data?.error?.code === "NOT_FOUND") notFound();
  if (result?.data?.error?.code === "FORBIDDEN") redirect("/documents");
  if (result?.data?.error) redirect("/documents");

  return <DocumentReviewClient data={result.data!.data!} />;
}
