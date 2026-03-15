"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DocumentReviewFooter } from "@/components/domain/document-review-footer";
import { DocumentReviewForm } from "@/components/domain/document-review-form";
import { DocumentReviewHeader } from "@/components/domain/document-review-header";
import { useDocumentReviewStore } from "@/hooks/use-document-review-store";
import { extractError } from "@/lib/extract-error";
import { updateDocumentCorrectionsAction } from "@/server/actions/documents";
import type { DocumentReviewData } from "@/server/services/documents";
import type { OcrLineItem } from "@/server/services/ocr";

const DocumentPreview = dynamic(() => import("@/components/domain/document-preview"), {
  ssr: false,
  loading: () => <div className="aspect-[3/4] animate-pulse rounded-lg bg-muted" />,
});

export function DocumentReviewClient({ data }: { data: DocumentReviewData }) {
  const [prefixType, setPrefixType] = useState(data.prefixType);
  const corrections = useDocumentReviewStore((s) => s.corrections);
  const saveStatus = useDocumentReviewStore((s) => s.saveStatus);
  const setCorrection = useDocumentReviewStore((s) => s.setCorrection);
  const setCorrections = useDocumentReviewStore((s) => s.setCorrections);
  const setSaveStatus = useDocumentReviewStore((s) => s.setSaveStatus);
  const resetFromServer = useDocumentReviewStore((s) => s.resetFromServer);

  // Initialize store from server data
  useEffect(() => {
    resetFromServer(data.resolvedData);
  }, [data.resolvedData, resetFromServer]);

  // Auto-save field change handler
  const handleFieldChange = useCallback(
    async (field: string, value: unknown) => {
      setCorrection(field, value);
      setSaveStatus(field, "saving");

      const result = await updateDocumentCorrectionsAction({
        documentId: data.id,
        patch: { [field]: value },
      });

      const error = extractError(result);
      if (error) {
        setSaveStatus(field, "error");
        toast.error(`Failed to save ${field}: ${error}`);
        return;
      }

      setSaveStatus(field, "saved");
    },
    [data.id, setCorrection, setSaveStatus],
  );

  // Line items save handler (full array replacement)
  const handleItemsChange = useCallback(
    async (items: OcrLineItem[]) => {
      setCorrections({ items });
      setSaveStatus("items", "saving");

      const result = await updateDocumentCorrectionsAction({
        documentId: data.id,
        patch: { items },
      });

      const error = extractError(result);
      if (error) {
        setSaveStatus("items", "error");
        toast.error(`Failed to save line items: ${error}`);
        return;
      }

      setSaveStatus("items", "saved");
    },
    [data.id, setCorrections, setSaveStatus],
  );

  // Classification change handler
  const handleClassificationChange = useCallback((newPrefixType: string) => {
    setPrefixType(newPrefixType);
  }, []);

  // Compute resolved data from store corrections
  const resolvedData = { ...data.resolvedData, ...corrections };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <DocumentReviewHeader data={data} />

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left pane — Preview (sticky) */}
        <div className="md:sticky md:top-6 md:self-start">
          <div
            className="overflow-hidden rounded-lg border bg-background"
            style={{ height: "calc(100vh - 200px)" }}
          >
            <DocumentPreview
              signedUrl={data.signedUrl}
              mimeType={data.mimeType}
              documentId={data.id}
            />
          </div>
        </div>

        {/* Right pane — Form (scrollable) */}
        <div className="space-y-6">
          <DocumentReviewForm
            data={data}
            resolvedData={resolvedData}
            prefixType={prefixType}
            readOnly={data.readOnly}
            saveStatus={saveStatus}
            onFieldChange={handleFieldChange}
            onItemsChange={handleItemsChange}
            onClassificationChange={handleClassificationChange}
          />

          <DocumentReviewFooter
            documentId={data.id}
            reviewedAt={data.reviewedAt}
            reviewedBy={data.reviewedBy}
            readOnly={data.readOnly}
            saveStatus={saveStatus}
          />
        </div>
      </div>
    </div>
  );
}
