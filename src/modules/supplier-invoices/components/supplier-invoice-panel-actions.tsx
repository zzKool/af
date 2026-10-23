"use client";

// The end of the supplier-invoice panel: uncancel a cancelled invoice; cancel (with a reason) or delete one that
// has no payments — delete only while nothing but its document is linked (D36: the document returns to the inbox).
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  cancelSupplierInvoiceAction,
  deleteSupplierInvoiceAction,
  uncancelSupplierInvoiceAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import type { SupplierInvoicePanelDetail } from "./supplier-invoice-panel-shared";

type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];

export function SupplierInvoicePanelActions({
  detail,
  canWrite,
  confirmCancel,
  confirmDelete,
  onChanged,
  onDeleted,
}: {
  detail: SupplierInvoicePanelDetail;
  canWrite: boolean;
  confirmCancel: Confirm;
  confirmDelete: Confirm;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const ids = useId();
  const [cancelReason, setCancelReason] = useState("");
  const { executeAsync: cancel, isPending: cancelling } = useAction(cancelSupplierInvoiceAction);
  const { executeAsync: uncancel } = useAction(uncancelSupplierInvoiceAction);
  const { executeAsync: remove } = useAction(deleteSupplierInvoiceAction);
  const si = detail.invoice;

  if (!canWrite) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {si.cancelled ? (
        <Button
          size="sm"
          variant="outline"
          data-testid="uncancel-invoice"
          onClick={async () => {
            const r = await uncancel({ id: si.id });
            const error = extractError(r);
            if (error) toast.error(error);
            else {
              toast.success(t("supplierInvoices.panel.uncancelled"));
              onChanged();
            }
          }}
        >
          {t("supplierInvoices.panel.uncancel")}
        </Button>
      ) : (
        detail.payments.length === 0 && (
          <>
            <div className="flex items-end gap-2">
              <div>
                <label htmlFor={`${ids}-reason`} className="mb-1 block text-xs font-medium">
                  {t("supplierInvoices.panel.cancelReason")}
                </label>
                <Input
                  id={`${ids}-reason`}
                  value={cancelReason}
                  onChange={(ev) => setCancelReason(ev.target.value)}
                  data-testid="cancel-reason"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={cancelling || !cancelReason.trim()}
                data-testid="cancel-invoice"
                onClick={() =>
                  confirmCancel(
                    async () => {
                      const r = await cancel({ id: si.id, reason: cancelReason.trim() });
                      const error = extractError(r);
                      if (error) throw new Error(error);
                      toast.success(t("supplierInvoices.panel.cancelled"));
                      onChanged();
                    },
                    { description: t("supplierInvoices.panel.cancelConfirm", { key: si.key }) },
                  )
                }
              >
                {t("supplierInvoices.panel.cancel")}
              </Button>
            </div>
            {detail.links.every((l) => l.kind === "created_from") && (
              <Button
                size="sm"
                variant="destructive"
                data-testid="delete-invoice"
                onClick={() =>
                  confirmDelete(
                    async () => {
                      const r = await remove({ id: si.id });
                      const error = extractError(r);
                      if (error) throw new Error(error);
                      toast.success(t("supplierInvoices.panel.deleted"));
                      onDeleted();
                    },
                    { description: t("supplierInvoices.panel.deleteConfirm", { key: si.key }) },
                  )
                }
              >
                {t("supplierInvoices.panel.delete")}
              </Button>
            )}
          </>
        )
      )}
    </div>
  );
}
