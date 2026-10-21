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

  // Determine button label and style based on 4 states
  const getButtonConfig = () => {
    if (modifiedSinceReview) {
      // State 4: amber — modified since last review
      return {
        label: t("documents.review.updateReview"),
        className:
          "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
        variant: "outline" as const,
      };
    }
    if (reviewedAt) {
      // State 3: muted green — already reviewed
      return {
        label: t("documents.review.reviewed"),
        className: "border-green-300 text-green-700 dark:border-green-700 dark:text-green-300",
        variant: "outline" as const,
      };
    }
    // State 1 & 2: green — not yet reviewed
    return {
      label:
        correctionsCount > 0
          ? t("documents.review.markReviewedCorrections", { count: correctionsCount })
          : t("documents.review.markReviewed"),
      className: "bg-green-600 hover:bg-green-700 text-white",
      variant: "default" as const,
    };
  };

  const buttonConfig = getButtonConfig();

  return (
    <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-3">
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
          className={buttonConfig.className}
        >
          {isSubmitting ? t("documents.review.marking") : buttonConfig.label}
        </Button>
      )}
    </div>
  );
}
