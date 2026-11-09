"use client";

// An issued invoice's figures (F163, Pulse everywhere — the board *Partner*'s KPI tiles): the total, what is paid
// (with how far), what is still open, and the due day as days to go or days late. Derived figures the page already
// has (`allocated`, `remaining`, the state); nothing computed here but the days and the share.
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { BAR, Kpi, KpiRow } from "@/kernel/ui/pulse";
import { cn } from "@/lib/utils";
import type { InvoiceState } from "@/modules/invoices/types";

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function InvoiceFigures({
  total,
  allocated,
  remaining,
  currency,
  dueDate,
  state,
  today,
  base,
}: {
  total: string;
  allocated: string;
  remaining: string;
  currency: string;
  dueDate: string | null;
  state: InvoiceState;
  today: string;
  /** F169: the total in the base, as stored at issue — beside the total of an invoice in a foreign currency */
  base?: { amount: string; currency: string } | null;
}) {
  const t = useT();
  const share = Number(total) > 0 ? Math.min(100, (Number(allocated) / Number(total)) * 100) : 0;
  const open = Number(remaining) > 0;
  const late = state === "overdue";
  const toGo = dueDate ? days(today, dueDate) : null;
  return (
    <KpiRow testId="invoice-figures">
      <Kpi
        label={t("invoices.fig.total")}
        value={formatMoney(total, currency)}
        sub={
          base ? (
            <span className="tabular-nums" data-testid="invoice-figures-base">
              {t("invoices.baseAtIssue", { amount: formatMoney(base.amount, base.currency) })}
            </span>
          ) : undefined
        }
      />
      <Kpi
        label={t("invoices.fig.paid")}
        value={formatMoney(allocated, currency)}
        tone={share >= 100 ? "done" : "neutral"}
        sub={
          <span className="flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className={cn("block h-full", BAR.done)} style={{ width: `${share}%` }} />
            </span>
            <span className="tabular-nums">{Math.round(share)} %</span>
          </span>
        }
      />
      <Kpi
        label={t("invoices.fig.open")}
        value={formatMoney(remaining, currency)}
        tone={!open ? "done" : late ? "danger" : "attention"}
        sub={open ? t("invoices.fig.openSub") : t("invoices.fig.nothingOpen")}
      />
      <Kpi
        label={t("invoices.fig.due")}
        value={
          !open
            ? t("invoices.fig.settled")
            : toGo === null
              ? "—"
              : toGo >= 0
                ? t("invoices.fig.inDays", { days: toGo })
                : t("invoices.fig.daysLate", { days: -toGo })
        }
        tone={!open ? "done" : late ? "danger" : "neutral"}
        sub={dueDate ?? undefined}
      />
    </KpiRow>
  );
}
