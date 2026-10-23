"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { FormattedDate } from "@/kernel/i18n/formatted-date";
import { useT } from "@/kernel/i18n/use-t";
import { markDocumentReviewedAction } from "@/modules/documents/documents.actions";

type DocumentReviewFooterProps = {
  documentId: string;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  updatedAt?: Date;
  readOnly: boolean;
  saveStatus: Record<string, string>;
  correctionsCount?: number;
};

export function DocumentReviewFooter({
  documentId,
  reviewedAt: initialReviewedAt,
  updatedAt,
  readOnly,
  saveStatus,
  correctionsCount = 0,
}: DocumentReviewFooterProps) {
  const t = useT();
  const [reviewedAt, setReviewedAt] = useState<Date | null>(initialReviewedAt);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSaving = Object.values(saveStatus).some((s) => s === "saving");
  const hasErrors = Object.values(saveStatus).some((s) => s === "error");

  // State 4: modified since last review (updatedAt > reviewedAt)
  const modifiedSinceReview =
    reviewedAt && updatedAt && new Date(updatedAt).getTime() > new Date(reviewedAt).getTime();

  const handleMarkReviewed = useCallback(async () => {
    setIsSubmitting(true);
    const result = await markDocumentReviewedAction({ documentId });
    setIsSubmitting(false);

    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }

    if (result?.data?.data?.reviewedAt) {
      setReviewedAt(new Date(result.data.data.reviewedAt));
      toast.success(t("documents.review.markedReviewed"));
    }
  }, [documentId, t]);

  const autoSaveLabel = isSaving
    ? t("documents.review.saving")
    : hasErrors
      ? t("documents.review.saveFailed")
      : t("documents.review.autoSaved");

  // The label by the 4 states; D40 colours only: a primary while there is something to mark, a secondary once
  // reviewed (the word says it — no green, no amber)
  const getButtonConfig = () => {
    if (modifiedSinceReview) {
      // State 4: modified since the last review — mark it again
      return { label: t("documents.review.updateReview"), variant: "default" as const };
    }
    if (reviewedAt) {
      // State 3: already reviewed
      return { label: t("documents.review.reviewed"), variant: "outline" as const };
    }
    // State 1 & 2: not yet reviewed
    return {
      label:
        correctionsCount > 0
          ? t("documents.review.markReviewedCorrections", { count: correctionsCount })
          : t("documents.review.markReviewed"),
      variant: "default" as const,
    };
  };

  const buttonConfig = getButtonConfig();

  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      {/* Auto-save status */}
      <div className="text-sm text-muted-foreground" aria-live="assertive">
        {hasErrors ? <span className="text-destructive">{autoSaveLabel}</span> : autoSaveLabel}
      </div>

      {/* Mark as Reviewed button */}
      {readOnly ? (
        <div className="text-sm text-muted-foreground">
          {reviewedAt ? (
            <span>
              {t("documents.review.reviewed")} <FormattedDate date={reviewedAt} />
            </span>
          ) : (
            t("documents.review.awaiting")
          )}
        </div>
      ) : (
        <Button
          onClick={handleMarkReviewed}
          disabled={isSubmitting || isSaving}
          variant={buttonConfig.variant}
        >
          {isSubmitting ? t("documents.review.marking") : buttonConfig.label}
        </Button>
      )}
    </div>
  );
}
