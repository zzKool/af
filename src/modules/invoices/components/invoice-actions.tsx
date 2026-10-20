"use client";

// The buttons above the sheet: what the lifecycle allows for this document and nothing else
// (specs/invoices §5.3). Issue asks once; everything after issue is a stamp, a copy or a credit note.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { getDocumentDownloadUrlAction } from "@/modules/documents/ui";
import {
  convertQuoteAction,
  copyToDraftAction,
  createCreditNoteAction,
  decideQuoteAction,
  deleteDraftAction,
  issueInvoiceAction,
  markSentAction,
} from "@/modules/invoices/invoices.actions";
import type { InvoiceState, InvoiceStatus, InvoiceType } from "@/modules/invoices/types";
import { STATE_STYLE } from "./invoice-table";

export function InvoiceActions({
  id,
  type,
  status,
  state,
  number,
  numberHint,
  pdfDocumentId,
  canWrite,
}: {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  state: InvoiceState;
  number: string | null;
  numberHint: string | null;
  pdfDocumentId: string | null;
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { executeAsync: issue, isPending: issuing } = useAction(issueInvoiceAction);
  const { executeAsync: markSent } = useAction(markSentAction);
  const { executeAsync: creditNote } = useAction(createCreditNoteAction);
  const { executeAsync: decide } = useAction(decideQuoteAction);
  const { executeAsync: convert } = useAction(convertQuoteAction);
  const { executeAsync: copy } = useAction(copyToDraftAction);
  const { executeAsync: remove } = useAction(deleteDraftAction);
  const { executeAsync: downloadUrl } = useAction(getDocumentDownloadUrlAction);
  const issueDialog = useConfirmDialog({
    title: t("invoices.action.issueConfirm.title", { number: numberHint ?? "…" }),
    confirmLabel: t("invoices.action.issue"),
  });
  const deleteDialog = useConfirmDialog({
    title: t("invoices.action.deleteConfirm.title"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });
  const [pdfPolls, setPdfPolls] = useState(0);

  // the PDF arrives a second or two after issue — refresh until it is there (bounded)
  useEffect(() => {
    if (status === "draft" || pdfDocumentId || pdfPolls > 20) return;
    const h = setTimeout(() => {
      setPdfPolls((n) => n + 1);
      router.refresh();
    }, 2000);
    return () => clearTimeout(h);
  }, [status, pdfDocumentId, pdfPolls, router]);

  const run = useCallback(
    async (
      fn: () => Promise<unknown>,
      success?: string,
      goTo?: (r: unknown) => string | undefined,
    ) => {
      const r = await fn();
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      if (success) toast.success(success);
      const href = goTo?.(r);
      if (href) router.push(href);
      else router.refresh();
    },
    [router],
  );
  const idOf = (r: unknown) => (r as { data?: { data?: { id?: string } } })?.data?.data?.id;

  const draft = status === "draft";
  const isQuote = type === "quote";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className={STATE_STYLE[state]} data-testid="invoice-state">
        {t(`invoices.state.${state}`)}
      </Badge>
      {canWrite && draft && (
        <>
          <Button
            size="sm"
            disabled={issuing}
            onClick={() =>
              issueDialog.confirm(
                async () => {
                  const r = await issue({ id });
                  const error = extractError(r);
                  if (error) throw new Error(error);
                  toast.success(t("invoices.issued", { number: r?.data?.data?.number ?? "" }));
                  router.refresh();
                },
                { description: t("invoices.action.issueConfirm.description") },
              )
            }
          >
            {t("invoices.action.issue")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              deleteDialog.confirm(
                async () => {
                  const r = await remove({ id });
                  const error = extractError(r);
                  if (error) throw new Error(error);
                  toast.success(t("invoices.deleted"));
                  router.push("/invoices");
                },
                { description: t("invoices.action.deleteConfirm.description") },
              )
            }
          >
            {t("invoices.action.deleteDraft")}
          </Button>
        </>
      )}
      {canWrite && !draft && status === "issued" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => run(() => markSent({ id }), t("invoices.sent"))}
        >
          {t("invoices.action.markSent")}
        </Button>
      )}
      {canWrite && !draft && isQuote && (status === "issued" || status === "sent") && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => decide({ id, decision: "accepted" }))}
          >
            {t("invoices.action.accept")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => decide({ id, decision: "declined" }))}
          >
            {t("invoices.action.decline")}
          </Button>
        </>
      )}
      {canWrite && !draft && isQuote && status !== "declined" && state !== "converted" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            run(
              () => convert({ id }),
              t("invoices.created"),
              (r) => (idOf(r) ? `/invoices/${idOf(r)}` : undefined),
            )
          }
        >
          {t("invoices.action.convert")}
        </Button>
      )}
      {canWrite && !draft && type === "invoice" && state !== "credited" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            run(
              () => creditNote({ originalId: id }),
              t("invoices.created"),
              (r) => (idOf(r) ? `/invoices/${idOf(r)}` : undefined),
            )
          }
        >
          {t("invoices.action.creditNote")}
        </Button>
      )}
      {canWrite && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            run(
              () => copy({ id }),
              t("invoices.created"),
              (r) => (idOf(r) ? `/invoices/${idOf(r)}` : undefined),
            )
          }
        >
          {t("invoices.action.copy")}
        </Button>
      )}
      {!draft &&
        (pdfDocumentId ? (
          <Button
            size="sm"
            variant="outline"
            data-testid="download-pdf"
            onClick={async () => {
              const r = await downloadUrl({ documentId: pdfDocumentId });
              const error = extractError(r);
              if (error) return toast.error(error);
              const url = r?.data?.data?.downloadUrl;
              if (url) window.open(url, "_blank", "noopener");
            }}
          >
            {t("invoices.action.downloadPdf")} · {number}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground" data-testid="pdf-pending">
            {t("invoices.action.pdfPending")}
          </span>
        ))}
      <ConfirmDialog {...issueDialog.dialogProps} />
      <ConfirmDialog {...deleteDialog.dialogProps} />
    </div>
  );
}
