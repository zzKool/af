"use client";

// The links of the supplier-invoice panel (in Proof), with the way to its graph — each link's kind as a tag.
import { useT } from "@/kernel/i18n/use-t";
import { Tag } from "@/kernel/ui/tags";
import { GraphLink } from "@/modules/linking/ui";
import { money, type SupplierInvoicePanelDetail } from "./supplier-invoice-panel-shared";

export function SupplierInvoiceLinksList({ detail }: { detail: SupplierInvoicePanelDetail }) {
  const t = useT();
  const si = detail.invoice;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground">
          {t("supplierInvoices.panel.links")}
        </h4>
        <GraphLink self={{ type: "supplier_invoice", id: si.id }} />
      </div>
      {detail.links.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("supplierInvoices.panel.noLinks")}</p>
      ) : (
        <ul
          className="divide-y divide-subtle rounded-md border text-[13px]"
          data-testid="panel-links"
        >
          {detail.links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <Tag>{t(`linking.kind.${l.kind}`)}</Tag>
                <span className="truncate">{l.otherLabel ?? `${l.to.type} ${l.to.id}`}</span>
              </span>
              {l.allocatedAmount && (
                <span className="shrink-0 tabular-nums" data-amount>
                  {money(l.allocatedAmount, l.currency ?? si.currency)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
