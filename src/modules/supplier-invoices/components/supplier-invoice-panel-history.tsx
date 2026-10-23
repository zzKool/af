"use client";

// The panel's *History* (D40, collapsed by default): the invoice's audit entries, newest first — when, in the
// browser's time (`yyyy-mm-dd hh:mm`), and what happened (`history.ts` names the entry).
import { useT } from "@/kernel/i18n/use-t";
import type { SupplierInvoicePanelDetail } from "./supplier-invoice-panel-shared";

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-10-23 14:02` in the viewer's time zone — the D40 date with the minute. */
export function historyTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SupplierInvoiceHistory({ detail }: { detail: SupplierInvoicePanelDetail }) {
  const t = useT();
  if (detail.history.length === 0)
    return (
      <p className="text-[13px] text-muted-foreground">{t("supplierInvoices.history.empty")}</p>
    );
  return (
    <ol className="flex flex-col gap-1 text-[13px]" data-testid="panel-history">
      {detail.history.map((h) => (
        <li key={h.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <time dateTime={h.at} className="text-muted-foreground tabular-nums">
            {historyTime(h.at)}
          </time>
          <span>{t(`supplierInvoices.history.${h.event}`)}</span>
        </li>
      ))}
    </ol>
  );
}
