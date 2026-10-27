"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { InfoBanner } from "@/kernel/ui/info-banner";
import type { CompanyIdentity } from "@/modules/documents/billed-to";
import { ArchivedSection } from "@/modules/documents/components/archived-section";
import { DocumentReviewFooter } from "@/modules/documents/components/document-review-footer";
import { DocumentReviewForm } from "@/modules/documents/components/document-review-form";
import { DocumentReviewHeader } from "@/modules/documents/components/document-review-header";
import {
  type Became,
  becameHref,
  type MakeItOptions,
  MakeItSection,
} from "@/modules/documents/components/make-it-section";
import { countCorrections } from "@/modules/documents/corrections-count";
import {
  type DocumentReviewData,
  type OcrExtractedData,
  type OcrLineItem,
  updateDocumentCorrectionsAction,
} from "@/modules/documents/documents.actions";
import { useDocumentReviewStore } from "@/modules/documents/stores/use-document-review-store";

const MAX_RETRIES = 3;
/** while the OCR reads the document (a type change, a re-run), the page looks again every few seconds */
const OCR_POLL_MS = 3000;
const OCR_POLL_MAX = 60; // three minutes: past that the inbox's *stuck* takes over
const READING = new Set(["uploaded", "processing"]);

async function saveWithRetry(
  documentId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await updateDocumentCorrectionsAction({ documentId, patch });
    const error = extractError(result);
    if (!error) return null;
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
    } else {
      return error;
    }
  }
  return "Save failed after retries";
}

const DocumentPreview = dynamic(() => import("@/modules/documents/components/document-preview"), {
  ssr: false,
  loading: () => <div className="aspect-[3/4] animate-pulse rounded-lg bg-muted" />,
});

export function DocumentReviewClient({
  data,
  became = null,
  makeItOptions = null,
  company = null,
}: {
  data: DocumentReviewData;
  /** what the document became (specs/documents US1) — the page reads the `created_from` link */
  became?: Became | null;
  /** the dialogs' option lists; null for the accountant and for generated documents (no *Make it…*) */
  makeItOptions?: MakeItOptions | null;
  /** who an invoice should be billed to (D53) — the page reads the company profile */
  company?: CompanyIdentity | null;
}) {
  const t = useT();
  const [prefixType, setPrefixType] = useState(data.prefixType);
  const corrections = useDocumentReviewStore((s) => s.corrections);
  const saveStatus = useDocumentReviewStore((s) => s.saveStatus);
  const setCorrection = useDocumentReviewStore((s) => s.setCorrection);
  const setCorrections = useDocumentReviewStore((s) => s.setCorrections);
  const setSaveStatus = useDocumentReviewStore((s) => s.setSaveStatus);
  const resetFromServer = useDocumentReviewStore((s) => s.resetFromServer);

  const router = useRouter();
  // the OCR is reading it (after a type change or a re-run): refresh until it is read or failed (D52)
  const reading = READING.has(data.status);
  useEffect(() => {
    if (!reading) return;
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      if (polls > OCR_POLL_MAX) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, OCR_POLL_MS);
    return () => clearInterval(id);
  }, [reading, router]);

  // Initialize store from server data
  useEffect(() => {
    resetFromServer(data.resolvedData);
  }, [data.resolvedData, resetFromServer]);

  // Auto-save field change handler with retry
  const handleFieldChange = useCallback(
    async (field: string, value: unknown) => {
      setCorrection(field, value);
      setSaveStatus(field, "saving");

      const error = await saveWithRetry(data.id, { [field]: value });
      if (error) {
        setSaveStatus(field, "error");
        toast.error(t("documents.review.fieldSaveFailed", { field, error }));
        return;
      }

      setSaveStatus(field, "saved");
    },
    [data.id, setCorrection, setSaveStatus, t],
  );

  // Line items save handler (full array replacement) with retry
  const handleItemsChange = useCallback(
    async (items: OcrLineItem[]) => {
      setCorrections({ items });
      setSaveStatus("items", "saving");

      const error = await saveWithRetry(data.id, { items });
      if (error) {
        setSaveStatus("items", "error");
        toast.error(t("documents.review.lineItemsSaveFailed", { error }));
        return;
      }

      setSaveStatus("items", "saved");
    },
    [data.id, setCorrections, setSaveStatus, t],
  );

  // Classification change handler
  const handleClassificationChange = useCallback((newPrefixType: string) => {
    setPrefixType(newPrefixType);
  }, []);

  // Compute resolved data from store corrections
  const resolvedData = { ...data.resolvedData, ...corrections };
  // the fields the owner changed: what differs from the OCR's reading — the store holds every resolved field, so
  // its key count was the number of fields read, not of corrections (14 on an untouched invoice)
  const correctionsCount = countCorrections(data.extractedData, resolvedData);

  return (
    <div className="flex flex-col gap-4 px-5 pt-3.5 pb-5">
      <DocumentReviewHeader
        data={data}
        became={became}
        reverseCharge={resolvedData.reverseCharge === true}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left pane — Preview (sticky) */}
        <div className="md:sticky md:top-6 md:self-start">
          <div
            className="overflow-hidden rounded-lg border bg-background"
            style={{ height: "calc(100vh - 200px)" }}
          >
            <DocumentPreview fileUrl={data.fileUrl} mimeType={data.mimeType} />
          </div>
        </div>

        {/* Right pane — Form (scrollable); a generated document (an issued invoice's PDF) has nothing to review */}
        <div className="space-y-6">
          {/* F97 US5 (review 2026-10-26 §1.3b): the entity is the truth once the document became it */}
          {became && data.status !== "generated" && (
            <div data-testid="became-banner">
              <InfoBanner
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={becameHref(became)} />}
                  >
                    {t("documents.review.becameEdit")}
                  </Button>
                }
              >
                {t("documents.review.becameReadOnly", { key: became.label ?? "" })}
              </InfoBanner>
            </div>
          )}
          {data.status === "generated" ? (
            <div className="rounded-lg border p-4 text-sm" data-testid="generated-document">
              <div className="font-medium">{data.businessKey}</div>
              <p className="mt-1 text-muted-foreground">{t("documents.review.generated")}</p>
            </div>
          ) : (
            <DocumentReviewForm
              // the fields are uncontrolled: a new reading (status, time) remounts them with its values
              key={`${data.status}-${new Date(data.updatedAt).getTime()}`}
              data={data}
              resolvedData={resolvedData}
              prefixType={prefixType}
              // F97 US5: once the document became something, the entity holds the truth — read-only here
              readOnly={data.readOnly || !!became}
              saveStatus={saveStatus}
              onFieldChange={handleFieldChange}
              onItemsChange={handleItemsChange}
              onClassificationChange={handleClassificationChange}
              company={company}
            />
          )}

          {/* FR-001: an archived document is parked — no *Make it…*, *Restore* instead (archive refuses a became row) */}
          {data.status !== "generated" && data.archivedAt && !became && (
            <ArchivedSection
              documentId={data.id}
              documentKey={data.businessKey}
              archivedAt={data.archivedAt}
              readOnly={data.readOnly}
            />
          )}

          {data.status !== "generated" &&
            (became || (makeItOptions && !data.readOnly && !data.archivedAt)) && (
              <MakeItSection
                documentId={data.id}
                documentKey={data.businessKey}
                facts={resolvedData}
                reviewedAt={data.reviewedAt}
                became={became}
                options={makeItOptions}
                financial={data.documentType === "financial"}
              />
            )}

          {data.status !== "generated" && (
            <DocumentReviewFooter
              documentId={data.id}
              reviewedAt={data.reviewedAt}
              reviewedBy={data.reviewedBy}
              updatedAt={data.updatedAt}
              readOnly={data.readOnly}
              saveStatus={saveStatus}
              correctionsCount={correctionsCount}
            />
          )}
        </div>
      </div>
    </div>
  );
}
