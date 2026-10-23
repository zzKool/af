"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { FormattedDate } from "@/kernel/i18n/formatted-date";
import { useT } from "@/kernel/i18n/use-t";
import { unarchiveDocumentsAction } from "@/modules/documents/documents.actions";

/**
 * An archived document is parked, not a work item (specs/documents FR-001, T022): the review page shows *Archived*
 * where *Make it…* would be, and the owner's *Restore* puts it back in the inbox — then *Make it…* comes back.
 */
export function ArchivedSection({
  documentId,
  documentKey,
  archivedAt,
  readOnly,
}: {
  documentId: string;
  documentKey: string;
  archivedAt: Date;
  readOnly: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);

  const restore = async () => {
    setRestoring(true);
    const result = await unarchiveDocumentsAction({ ids: [documentId] });
    setRestoring(false);
    const error = extractError(result);
    const restored = result?.data?.data?.some((o) => o.outcome === "restored") ?? false;
    if (error || !restored) {
      toast.error(error ?? t("documents.inbox.toast.restoreNone"));
      return;
    }
    toast.success(t("documents.review.restored", { key: documentKey }));
    router.refresh();
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm"
      data-testid="document-archived"
    >
      <span className="text-muted-foreground">
        {t("documents.inbox.state.archived")} <FormattedDate date={archivedAt} />
      </span>
      {!readOnly && (
        <Button variant="outline" size="sm" onClick={restore} disabled={restoring}>
          {t("documents.inbox.action.restore")}
        </Button>
      )}
    </div>
  );
}
