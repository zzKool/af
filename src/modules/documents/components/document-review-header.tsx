"use client";

// The review page's title row (D40, F71): the key in mono with its derived state (the inbox's word, through the
// module's one family map) · tags for the kind and the OCR quality · what it became as a link · meta: file, size,
// uploaded, reviewed. No back link of its own: the shell's breadcrumb (Documents ›) is the way back. The page's one action here is *Re-run OCR* (owner, extracted only); *Make it…* and
// *Mark as Reviewed* sit with the form.
import Link from "next/link";
import { FormattedDate } from "@/kernel/i18n/formatted-date";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { PageHeader } from "@/kernel/ui/shell/page";
import { Tag } from "@/kernel/ui/tags";
import type { DocumentReviewData } from "@/modules/documents/documents.actions";
import { documentState } from "../state-family";
import { DocumentStateLabel } from "./document-state-label";
import { type Became, becameHref } from "./make-it-section";
import { RerunOcrButton } from "./rerun-ocr-button";

const QUALITY_LABEL: Record<string, MessageKey> = {
  high: "documents.review.quality.high",
  low: "documents.review.quality.low",
  none: "documents.review.quality.none",
};

const UPLOAD_KINDS = ["expense", "invoice", "contract", "nda", "certificate"];

export function DocumentReviewHeader({
  data,
  became = null,
  reverseCharge = false,
}: {
  data: DocumentReviewData;
  became?: Became | null;
  /** the document says the buyer pays the VAT (D54) — a tag, nothing computed */
  reverseCharge?: boolean;
}) {
  const t = useT();
  const quality = data.quality ? QUALITY_LABEL[data.quality] : undefined;
  const fileSizeKb = Math.round(data.fileSize / 1024);
  const state = documentState(
    {
      status: data.status,
      archivedAt: data.archivedAt,
      reviewedAt: data.reviewedAt,
      updatedAt: new Date(data.updatedAt),
      became: !!became,
    },
    new Date(),
  );

  return (
    <PageHeader
      title={
        <span className="flex min-w-0 items-center gap-3">
          <span className="truncate font-mono" data-testid="document-review-key">
            {data.businessKey}
          </span>
          <DocumentStateLabel state={state} testId="document-review-state" />
        </span>
      }
      tags={
        <>
          {UPLOAD_KINDS.includes(data.prefixType) && (
            <Tag>{t(`documents.prefix.${data.prefixType}` as MessageKey)}</Tag>
          )}
          {reverseCharge && <Tag>{t("documents.review.reverseCharge")}</Tag>}
          {/* OCR quality is metadata about the extraction, not a state — owner only */}
          {!data.readOnly && quality && <Tag>{t(quality)}</Tag>}
          {became && (
            <Link
              href={becameHref(became)}
              className="text-[13px] text-primary hover:underline"
              data-testid="became-chip"
            >
              {t(
                became.type === "expense"
                  ? "documents.makeIt.becameExpense"
                  : "documents.makeIt.becameSupplierInvoice",
                { key: became.label ?? "" },
              )}
            </Link>
          )}
        </>
      }
      meta={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>{data.fileName}</span>
          <span className="tabular-nums">{fileSizeKb} KB</span>
          <span>
            {t("documents.review.uploaded")} <FormattedDate date={data.createdAt} />
          </span>
          {data.reviewedAt ? (
            <span>
              {t("documents.review.reviewed")} <FormattedDate date={data.reviewedAt} />
            </span>
          ) : (
            <span>{t("documents.review.awaiting")}</span>
          )}
        </span>
      }
      // FR-021: a completed OCR is re-run only from here, explicitly (owner)
      actions={
        !data.readOnly && data.status === "extracted" ? (
          <RerunOcrButton documentId={data.id} documentKey={data.businessKey} />
        ) : undefined
      }
    />
  );
}
