"use client";

// The title row's buttons: what the lifecycle allows for this document and nothing else (specs/invoices §5.3).
// Issue asks once; everything after issue is a stamp, a copy or a credit note. D40 (F71): the stamps and the
// PDF are secondary; ONE primary — Issue on a draft, else the document made from this one (credit note for an
// invoice, convert for a quote) with Copy behind ▾. The state is not here: it is the title's <StateLabel>.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { SplitButton } from "@/kernel/ui/split-button";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { cn } from "@/lib/utils";
import { getDocumentDownloadUrlAction } from "@/modules/documents/ui";
import {
  convertQuoteAction,
  copyToDraftAction,
  createCreditNoteAction,
  decideQuoteAction,
  deleteDraftAction,
  issueInvoiceAction,
  markSentAction,
  requeueInvoicePdfAction,
} from "@/modules/invoices/invoices.actions";
import type { InvoiceState, InvoiceStatus, InvoiceType } from "@/modules/invoices/types";

/** 10 polls × 2 s + 20 × 5 s ≈ 2 min — longer than the slowest render seen on CI. */
const PDF_POLL_LIMIT = 30;
export function InvoiceActions({
  id,
  type,
  status,
  state,
  numberHint,
  pdfDocumentId,
  canWrite,
}: {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  state: InvoiceState;
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
  const { executeAsync: requeuePdf } = useAction(requeueInvoicePdfAction);
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

  // the PDF arrives a second or two after issue — refresh until it is there. Bounded at ~2 min, not ~40 s:
  // behind a queue of OCR jobs (one at a time) on a busy machine the render can take longer, and a page that
  // stopped polling never shows the button without a reload. Every 2 s for 20 s, then every 5 s.
  useEffect(() => {
    if (status === "draft" || pdfDocumentId || pdfPolls >= PDF_POLL_LIMIT) return;
    const h = setTimeout(
      () => {
        setPdfPolls((n) => n + 1);
        router.refresh();
      },
      pdfPolls < 10 ? 2000 : 5000,
    );
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

  const doCopy = () =>
    run(
      () => copy({ id }),
      t("invoices.created"),
      (r) => (idOf(r) ? `/invoices/${idOf(r)}` : undefined),
    );
  const doCreditNote = () =>
    run(
      () => creditNote({ originalId: id }),
      t("invoices.created"),
      (r) => (idOf(r) ? `/invoices/${idOf(r)}` : undefined),
    );
  const doConvert = () =>
    run(
      () => convert({ id }),
      t("invoices.created"),
      (r) => (idOf(r) ? `/invoices/${idOf(r)}` : undefined),
    );
  const canCredit = type === "invoice" && state !== "credited";
  const canConvert = isQuote && status !== "declined" && state !== "converted";

  // F169, the board *Invoice studio*: the PDF — the stored one, or made now while the job has not stored it yet (F145)
  const openPdf = async (): Promise<boolean> => {
    if (!pdfDocumentId) {
      window.open(`/invoices/${id}/pdf`, "_blank", "noopener");
      return true;
    }
    const r = await downloadUrl({ documentId: pdfDocumentId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return false;
    }
    const url = r?.data?.data?.downloadUrl;
    if (url) window.open(url, "_blank", "noopener");
    return !!url;
  };
  // the PDF first, then the existing *mark as sent* — not marked when the PDF could not be had
  const [sending, setSending] = useState(false);
  const downloadAndSend = async () => {
    setSending(true);
    try {
      if (await openPdf()) await run(() => markSent({ id }), t("invoices.sent"));
    } finally {
      setSending(false);
    }
  };
  /** issued, not sent yet: sending is the next move, so it is the row's primary */
  const sendIsPrimary = canWrite && status === "issued";

  /** the one primary of a document that is no longer a draft: what is made from it */
  function madeFromThis() {
    const variant = sendIsPrimary ? "outline" : "default";
    if (canCredit || canConvert)
      return (
        <SplitButton
          variant={variant}
          onClick={canCredit ? doCreditNote : doConvert}
          items={[{ label: t("invoices.action.copy"), onClick: doCopy }]}
          menuLabel={t("invoices.new")}
        >
          {canCredit ? t("invoices.action.creditNote") : t("invoices.action.convert")}
        </SplitButton>
      );
    return (
      <Button variant={variant} onClick={doCopy}>
        {t("invoices.action.copy")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!draft &&
        (pdfDocumentId ? (
          <Button variant="outline" data-testid="download-pdf" onClick={() => void openPdf()}>
            {t("invoices.action.downloadPdf")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground" data-testid="pdf-pending">
            {/* F145: the stored PDF is not there yet — the same page, made now */}
            <a
              href={`/invoices/${id}/pdf`}
              target="_blank"
              rel="noopener"
              className={cn(buttonVariants({ variant: "outline" }), "mr-2")}
              data-testid="open-pdf"
            >
              {t("invoices.action.downloadPdf")}
            </a>
            {t("invoices.action.pdfPending")}
            {/* V12 / F110: the polls ran out — the render may still queue, or it failed for good (the History
                says which). One click queues it again (exclusive per invoice: never doubled) and polls again. */}
            {pdfPolls >= PDF_POLL_LIMIT && (
              <Button
                size="sm"
                variant="link"
                className="ml-1 h-auto p-0 text-xs"
                data-testid="pdf-poll-again"
                onClick={async () => {
                  const r = await requeuePdf({ id });
                  const error = extractError(r);
                  if (error) return toast.error(error);
                  setPdfPolls(0);
                  router.refresh();
                }}
              >
                {t("invoices.action.pdfAgain")}
              </Button>
            )}
          </span>
        ))}
      {draft && (
        <a
          href={`/invoices/${id}/pdf`}
          target="_blank"
          rel="noopener"
          className={buttonVariants({ variant: "outline" })}
          data-testid="preview-pdf"
        >
          {t("invoices.pdf.preview")}
        </a>
      )}
      {canWrite && draft && (
        <>
          <Button
            variant="outline"
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
          <Button variant="outline" onClick={doCopy}>
            {t("invoices.action.copy")}
          </Button>
          <Button
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
        </>
      )}
      {canWrite && !draft && status === "issued" && (
        <Button variant="outline" onClick={() => run(() => markSent({ id }), t("invoices.sent"))}>
          {t("invoices.action.markSent")}
        </Button>
      )}
      {canWrite && !draft && isQuote && (status === "issued" || status === "sent") && (
        <>
          <Button variant="outline" onClick={() => run(() => decide({ id, decision: "accepted" }))}>
            {t("invoices.action.accept")}
          </Button>
          <Button variant="outline" onClick={() => run(() => decide({ id, decision: "declined" }))}>
            {t("invoices.action.decline")}
          </Button>
        </>
      )}
      {canWrite && !draft && madeFromThis()}
      {sendIsPrimary && (
        <Button disabled={sending} onClick={downloadAndSend} data-testid="download-and-send">
          {t("invoices.action.downloadAndSend")}
        </Button>
      )}
      <ConfirmDialog {...issueDialog.dialogProps} />
      <ConfirmDialog {...deleteDialog.dialogProps} />
    </div>
  );
}
