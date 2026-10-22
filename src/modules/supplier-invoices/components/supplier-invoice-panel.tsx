"use client";

// The side panel of one supplier invoice: loads the detail (and the payable rows while it is open) and saves
// patches; the sections render it — money (editable while unpaid and unlinked) · payments with *Link payment* ·
// facts, lines, document · links — and the panel ends with cancel / uncancel, delete.
import Link from "next/link";
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
import { SupplierInvoiceStatusBadge } from "./status-badge";
import { SupplierInvoicePanelActions } from "./supplier-invoice-panel-actions";
import {
  SupplierInvoiceDocumentSection,
  SupplierInvoiceFactsSection,
  SupplierInvoiceLinesSection,
} from "./supplier-invoice-panel-facts";
import { SupplierInvoiceLinksSection } from "./supplier-invoice-panel-links";
import { SupplierInvoiceMoneySection } from "./supplier-invoice-panel-money";
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
      const detail = d as unknown as SupplierInvoicePanelDetail;
      setDetail(detail);
      if (!detail.invoice.cancelled && detail.open !== "0.00") {
        const p = await loadPayable({ currency: detail.linkCurrency });
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
                <span className="font-mono" data-testid="panel-key">
                  {si.key}
                </span>
                <span className="tabular-nums" data-testid="panel-amount">
                  {money(si.amountTotal, si.currency)}
                </span>
                <SupplierInvoiceStatusBadge
                  status={detail.status}
                  daysOverdue={detail.daysOverdue}
                  testId="panel-status"
                />
              </SheetTitle>
              <SheetDescription>
                {detail.partnerName} · {si.invoiceNumber} ·{" "}
                <Link href={`/expenses/groups/${si.groupId}`} className="hover:underline">
                  {detail.groupLabel}
                </Link>{" "}
                · {detail.basLabel}
              </SheetDescription>
            </SheetHeader>

            <SupplierInvoiceMoneySection
              detail={detail}
              suppliers={suppliers}
              canWrite={canWrite}
              editable={detail.editable && canWrite}
              save={save}
              saving={saving}
            />
            <SupplierInvoicePaymentsSection
              detail={detail}
              payable={payable}
              canWrite={canWrite}
              onChanged={changed}
            />
            <SupplierInvoiceFactsSection
              detail={detail}
              categories={categories}
              registrations={registrations}
              canWrite={canWrite}
              save={save}
              saving={saving}
            />
            <SupplierInvoiceLinesSection detail={detail} />
            <SupplierInvoiceDocumentSection detail={detail} />
            <SupplierInvoiceLinksSection detail={detail} />

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
