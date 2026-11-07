"use client";

// The account cards (D76, the Pulse banking board): one raised card per statement account — its name and kind,
// the latest balance, how far the balance chain is complete and when it was last imported, and a bar of the
// month's rows justified (green) against still to justify (amber). A click filters the list to that account; a
// second click clears it. Read only; the figures come from `accountBalances` and `bankMonths` (derived).
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import {
  type AccountBalance,
  type BankMonthsOverview,
  STATEMENT_ROLES,
} from "@/modules/banking/types";

export type AccountCardBalance = Omit<AccountBalance, "lastImportAt"> & {
  lastImportAt: string | null;
};

export function AccountCards({
  balances,
  months,
  month,
  activeLabels,
  onToggle,
  compact = false,
}: {
  /** a row is open: one line of small cards, the list stays near the top (D76) */
  compact?: boolean;
  balances: AccountCardBalance[];
  /** the Months overview — the per-account month cells and the chain's completeness; absent before any row */
  months?: BankMonthsOverview;
  /** the month the bars count: the Month filter's, else the newest month with rows */
  month: string | null;
  /** the Account filter's values */
  activeLabels: string[];
  onToggle: (label: string) => void;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        compact
          ? "flex flex-wrap gap-2"
          : "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3",
      )}
      data-testid="account-balances"
    >
      {/* the statement accounts only: a private instrument (D60) has no statement and no balance */}
      {balances
        .filter((b) => STATEMENT_ROLES.includes(b.role))
        .map((b) => {
          const active = activeLabels.length === 1 && activeLabels[0] === b.label;
          const account = months?.accounts.find((a) => a.id === b.bankAccountId);
          const cell =
            month && months
              ? months.cells.find((c) => c.bankAccountId === b.bankAccountId && c.month === month)
              : undefined;
          const rows = cell?.rows ?? 0;
          const toJustify = cell?.toJustify ?? 0;
          const justified = rows - toJustify;
          const pct = (n: number) => (rows ? `${(n / rows) * 100}%` : "0%");
          if (compact)
            return (
              <button
                type="button"
                key={b.bankAccountId}
                aria-pressed={active}
                onClick={() => onToggle(b.label)}
                data-testid={`account-card-${b.bankAccountId}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border border-subtle bg-surface px-3 py-1.5 text-left text-[12.5px] shadow-xs outline-none hover:border-border focus-visible:ring-2 focus-visible:ring-ring",
                  active && "ring-2 ring-primary",
                )}
              >
                <span className="font-semibold">{b.label}</span>
                <span className="font-mono tabular-nums">
                  {b.balance ? formatMoney(b.balance, b.currency) : "—"}
                </span>
                {month && rows > 0 && (
                  <span
                    className="flex h-[5px] w-10 overflow-hidden rounded-full bg-tag"
                    aria-hidden
                  >
                    <i className="block h-full bg-state-done" style={{ width: pct(justified) }} />
                    <i
                      className="block h-full bg-state-attention"
                      style={{ width: pct(toJustify) }}
                    />
                  </span>
                )}
              </button>
            );
          return (
            <button
              type="button"
              key={b.bankAccountId}
              aria-pressed={active}
              onClick={() => onToggle(b.label)}
              data-testid={`account-card-${b.bankAccountId}`}
              className={cn(
                "flex min-w-0 flex-col gap-1.5 rounded-2xl border border-subtle bg-surface px-4 py-3.5 text-left shadow-card outline-none transition-shadow hover:border-border focus-visible:ring-2 focus-visible:ring-ring",
                active && "ring-2 ring-primary",
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className="truncate font-semibold">{b.label}</span>
                <span className="ml-auto shrink-0 text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
                  {t(`banking.cards.role.${b.role}`, { currency: b.currency })}
                </span>
              </span>
              <span className="text-[22px] leading-7 font-semibold tracking-tight tabular-nums">
                {b.balance ? formatMoney(b.balance, b.currency) : "—"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {[
                  account?.completeTo
                    ? t("banking.months.completeTo", { date: account.completeTo })
                    : b.balanceDate
                      ? t("banking.balances.asOf", { date: b.balanceDate })
                      : t("banking.balances.never"),
                  b.lastImportAt
                    ? t("banking.cards.imported", { date: b.lastImportAt.slice(0, 10) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {month && (
                <>
                  <span
                    className="mt-1 flex h-[5px] w-full overflow-hidden rounded-full bg-tag"
                    aria-hidden
                  >
                    <i className="block h-full bg-state-done" style={{ width: pct(justified) }} />
                    <i
                      className="block h-full bg-state-attention"
                      style={{ width: pct(toJustify) }}
                    />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {rows
                      ? t("banking.cards.justified", { justified, rows, month })
                      : t("banking.cards.noRows", { month })}
                  </span>
                </>
              )}
            </button>
          );
        })}
    </div>
  );
}
