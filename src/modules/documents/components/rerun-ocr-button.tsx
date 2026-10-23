"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { runOcrAction } from "@/modules/documents/documents.actions";

/**
 * *Re-run OCR* on an extracted document (specs/documents FR-021, T021): the inbox refuses a completed row and sends
 * the owner here; the explicit confirm is the `force`. Corrections are kept, the extracted facts are replaced.
 */
export function RerunOcrButton({
  documentId,
  documentKey,
}: {
  documentId: string;
  documentKey: string;
}) {
  const t = useT();
  const router = useRouter();
  const dialog = useConfirmDialog({
    title: t("documents.review.rerunOcr"),
    description: t("documents.review.rerunOcrConfirm"),
    confirmLabel: t("documents.review.rerunOcr"),
    cancelLabel: t("common.cancel"),
    variant: "default",
  });

  const rerun = async () => {
    const result = await runOcrAction({ documentId, force: true });
    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("documents.inbox.toast.ocrStarted", { key: documentKey }));
    router.refresh();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => dialog.confirm(rerun)}
        data-testid="rerun-ocr"
      >
        <RotateCw className="size-4" />
        {t("documents.review.rerunOcr")}
      </Button>
      <ConfirmDialog {...dialog.dialogProps} />
    </>
  );
}
