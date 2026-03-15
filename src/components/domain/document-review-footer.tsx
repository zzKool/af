"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { FormattedDate } from "@/components/domain/formatted-date";
import { Button } from "@/components/ui/button";
import { extractError } from "@/lib/extract-error";
import { markDocumentReviewedAction } from "@/server/actions/documents";

type DocumentReviewFooterProps = {
  documentId: string;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  updatedAt?: Date;
  readOnly: boolean;
  saveStatus: Record<string, string>;
};

export function DocumentReviewFooter({
  documentId,
  reviewedAt: initialReviewedAt,
  updatedAt,
  readOnly,
  saveStatus,
}: DocumentReviewFooterProps) {
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
      toast.success("Document marked as reviewed");
    }
  }, [documentId]);

  const autoSaveLabel = isSaving ? "Saving..." : hasErrors ? "Save failed" : "Auto-saved";

  // Determine button label and style based on 4 states
  const getButtonConfig = () => {
    if (modifiedSinceReview) {
      // State 4: amber — modified since last review
      return {
        label: "Update Review (modified since last review)",
        className:
          "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
        variant: "outline" as const,
      };
    }
    if (reviewedAt) {
      // State 3: muted green — already reviewed
      return {
        label: "Reviewed",
        className: "border-green-300 text-green-700 dark:border-green-700 dark:text-green-300",
        variant: "outline" as const,
      };
    }
    // State 1 & 2: green — not yet reviewed
    return {
      label: "Mark as Reviewed",
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
              Reviewed <FormattedDate date={reviewedAt} />
            </span>
          ) : (
            "Awaiting review"
          )}
        </div>
      ) : (
        <Button
          onClick={handleMarkReviewed}
          disabled={isSubmitting || isSaving}
          variant={buttonConfig.variant}
          className={buttonConfig.className}
        >
          {isSubmitting ? "Marking..." : buttonConfig.label}
        </Button>
      )}
    </div>
  );
}
