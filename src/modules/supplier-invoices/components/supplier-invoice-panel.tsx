"use client";

// The side panel of one supplier invoice (D40 details panel): loads the detail (and the payable rows while it is
// open) and saves patches. Title: the key, the total, the state. Sections: About (group, money read-out, base,
// paid, open) · Proof (document, payments with *Link payment*, links) · the forms (money while a draft — D37 —,
// facts while not cancelled) · Lines · History (collapsed); it ends with cancel / reinstate, delete.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsSection } from "@/kernel/ui/details-section";
import { CodeChip } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import type { PayableTransaction } from "@/modules/supplier-invoices/queries";
import {
  getSupplierInvoiceAction,
  payableTransactionsAction,
  updateSupplierInvoiceAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import type {
  CategoryOption,
  RegistrationOption,
  SupplierOption,
} from "@/modules/supplier-invoices/types";
import { SupplierInvoiceStateLabel } from "./state-label";
import { SupplierInvoiceAbout } from "./supplier-invoice-panel-about";
import { SupplierInvoicePanelActions } from "./supplier-invoice-panel-actions";
import {
  SupplierInvoiceDocumentLine,
  SupplierInvoiceFactsForm,
  SupplierInvoiceLines,
} from "./supplier-invoice-panel-facts";
import { SupplierInvoiceHistory } from "./supplier-invoice-panel-history";
import { SupplierInvoiceLinksList } from "./supplier-invoice-panel-links";
import { SupplierInvoiceMoneyForm } from "./supplier-invoice-panel-money";
import { SupplierInvoicePaymentsSection } from "./supplier-invoice-panel-payments";
import {
  money,
  type SupplierInvoicePanelDetail,
  type SupplierInvoicePatch,
} from "./supplier-invoice-panel-shared";

export function SupplierInvoicePanel({
  invoiceId,
  onClose,
  categories,
  suppliers,
  registrations,
  canWrite,
  onChanged,
}: {
  invoiceId: string | null;
  onClose: () => void;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  registrations: RegistrationOption[];
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [detail, setDetail] = useState<SupplierInvoicePanelDetail | null>(null);
  const [payable, setPayable] = useState<PayableTransaction[]>([]);
  const { executeAsync: load } = useAction(getSupplierInvoiceAction);
  const { executeAsync: loadPayable } = useAction(payableTransactionsAction);
  const { executeAsync: update, isPending: saving } = useAction(updateSupplierInvoiceAction);
  const deleteDialog = useConfirmDialog({
    title: t("supplierInvoices.panel.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });
  const cancelDialog = useConfirmDialog({
    title: t("supplierInvoices.panel.cancel"),
    variant: "destructive",
    confirmLabel: t("supplierInvoices.panel.cancel"),
  });

  const reload = useCallback(async () => {
    if (!invoiceId) return;
    const r = await load({ id: invoiceId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) {
      setDetail(d);
      if (!d.invoice.cancelled && d.open !== "0.00") {
        const p = await loadPayable({ currency: d.linkCurrency });
        const rows = p?.data && "data" in p.data ? p.data.data : [];
        setPayable(rows ?? []);
      } else {
        setPayable([]);
      }
    }
  }, [invoiceId, load, loadPayable]);

  useEffect(() => {
    setDetail(null);
    void reload();
  }, [reload]);

  function changed() {
    void reload();
    onChanged?.();
    router.refresh();
  }

  async function save(patch: SupplierInvoicePatch) {
    if (!detail) return;
    const r = await update({ id: detail.invoice.id, data: patch });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      void reload();
      return;
    }
    toast.success(t("supplierInvoices.panel.saved"));
    changed();
  }

  const si = detail?.invoice;

  return (
    <Sheet open={!!invoiceId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="supplier-invoice-panel">
        {si && detail ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <CodeChip>
                  <span data-testid="panel-key">{si.key}</span>
                </CodeChip>
                <SupplierInvoiceStateLabel
                  status={detail.status}
                  daysOverdue={detail.daysOverdue}
                  testId="panel-status"
                />
              </SheetTitle>
              <div className="text-[22px] font-semibold tabular-nums" data-testid="panel-amount">
                {money(si.amountTotal, si.currency)}
              </div>
              <SheetDescription>
                {detail.partnerName} · {si.invoiceNumber} · {detail.basLabel}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col">
              <DetailsSection title={t("details.about")}>
                <SupplierInvoiceAbout detail={detail} canWrite={canWrite} />
              </DetailsSection>
              <DetailsSection title={t("details.proof")}>
                <div className="flex flex-col gap-3">
                  <SupplierInvoiceDocumentLine detail={detail} />
                  <SupplierInvoicePaymentsSection
                    detail={detail}
                    payable={payable}
                    canWrite={canWrite}
                    onChanged={changed}
                  />
                  <SupplierInvoiceLinksList detail={detail} />
                </div>
              </DetailsSection>
              {detail.editable && canWrite && (
                <DetailsSection title={t("supplierInvoices.panel.money")}>
                  <SupplierInvoiceMoneyForm
                    detail={detail}
                    suppliers={suppliers}
                    save={save}
                    saving={saving}
                  />
                </DetailsSection>
              )}
              {canWrite && !si.cancelled && (
                <DetailsSection title={t("supplierInvoices.panel.facts")}>
                  <SupplierInvoiceFactsForm
                    detail={detail}
                    categories={categories}
                    registrations={registrations}
                    save={save}
                    saving={saving}
                  />
                </DetailsSection>
              )}
              {si.lines.length > 0 && (
                <DetailsSection title={t("supplierInvoices.panel.lines")}>
                  <SupplierInvoiceLines detail={detail} />
                </DetailsSection>
              )}
              <DetailsSection title={t("details.history")} defaultOpen={false}>
                <SupplierInvoiceHistory detail={detail} />
              </DetailsSection>
            </div>

            <SupplierInvoicePanelActions
              detail={detail}
              canWrite={canWrite}
              confirmCancel={cancelDialog.confirm}
              confirmDelete={deleteDialog.confirm}
              onChanged={changed}
              onDeleted={() => {
                onClose();
                onChanged?.();
                router.refresh();
              }}
            />
            <ConfirmDialog {...deleteDialog.dialogProps} />
            <ConfirmDialog {...cancelDialog.dialogProps} />
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>…</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
