"use client";

// The month, day by day (D76, the Pulse banking board): one column per day — on top the money in (green, up) and
// out (down) in the base currency, under it one square per statement account (green: every row justified · amber:
// something to justify · faint: no row). A day is a button: a click filters the list to that day, again clears it.
// The header switches the month (the months with rows, newest last — the Month filter) and opens the year view,
// the Months panel (F69: per account × month proven / open / incomplete / not imported). Derived, read only.
import { useState } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import { type BankMonthsOverview, STATEMENT_ROLES } from "@/modules/banking/types";
import { MonthsPanel } from "./months-panel";

const MONEY_HEIGHT = 44;

/** every day of `yyyy-mm`, `yyyy-mm-01` first */
export function daysOf(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function DayStrip({
  overview,
  month,
  selectedMonth,
  selectedDay,
  onSelectMonth,
  onSelectDay,
}: {
  overview: BankMonthsOverview;
  /** the month shown: the Month filter's, else the newest month with rows */
  month: string;
  /** the Month filter's month alone, if any */
  selectedMonth: string | null;
  /** the date filter's single day, if any */
  selectedDay: string | null;
  onSelectMonth: (month: string | null) => void;
  onSelectDay: (day: string | null) => void;
}) {
  const t = useT();
  const [year, setYear] = useState(false);
  const accounts = overview.accounts.filter((a) => STATEMENT_ROLES.includes(a.role));
  const days = daysOf(month);
  const inMonth = overview.days.filter((d) => d.date.startsWith(month));
  const at = (date: string, account?: string) =>
    inMonth.filter((d) => d.date === date && (!account || d.bankAccountId === account));
  const sum = (cells: typeof inMonth, k: "inBase" | "outBase") =>
    cells.reduce((n, c) => n + Number(c[k]), 0);
  const max = Math.max(
    1,
    ...days.map((d) => Math.max(sum(at(d), "inBase"), sum(at(d), "outBase"))),
  );
  // a square-root scale: one large transfer does not flatten every other day
  const scale = (v: number) => (v > 0 ? Math.max(2, Math.sqrt(v / max) * MONEY_HEIGHT) : 0);
  // the month segment: the newest six months with rows, and the month shown
  const withRows = overview.months.filter((m) => m.justified + m.toJustify > 0).map((m) => m.month);
  const segment = [...new Set([...withRows.slice(-6), month])].sort();
  const thisMonth = overview.to;
  const columns = `8rem repeat(${days.length}, minmax(0.75rem, 1fr))`;

  return (
    <section
      aria-label={t("banking.days.title", { month })}
      data-testid="months-panel"
      className="pulse-card px-4 py-3.5"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[13px] font-semibold">
          {year ? t("banking.months.title") : t("banking.days.title", { month })}
        </h2>
        {!year && <span className="text-xs text-muted-foreground">{t("banking.days.hint")}</span>}
        <div className="ml-auto flex items-center gap-2">
          {!year && (
            <div className="inline-flex gap-0.5 rounded-[10px] border border-subtle bg-surface-2 p-[3px]">
              {segment.map((m) => {
                const on = m === selectedMonth;
                return (
                  <button
                    type="button"
                    key={m}
                    data-month={m}
                    aria-pressed={on}
                    data-public
                    onClick={() => onSelectMonth(on ? null : m)}
                    className={cn(
                      "h-7 rounded-[7px] px-2.5 text-[12px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on
                        ? "bg-action font-semibold text-action-fg"
                        : m === month
                          ? "font-semibold text-foreground hover:bg-hover"
                          : "text-muted-foreground hover:bg-hover hover:text-foreground",
                    )}
                  >
                    {m === thisMonth ? t("banking.days.thisMonth") : m}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            aria-pressed={year}
            onClick={() => setYear((y) => !y)}
            className="h-8 rounded-lg border border-subtle bg-surface px-3 text-[12px] shadow-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="days-year"
          >
            {year ? t("banking.days.dayByDay") : t("banking.days.year")}
          </button>
        </div>
      </div>

      {year ? (
        <MonthsPanel
          embedded
          overview={overview}
          selectedMonth={selectedMonth}
          onSelectMonth={onSelectMonth}
        />
      ) : (
        <div className="grid items-end gap-x-[3px]" style={{ gridTemplateColumns: columns }}>
          {/* row 1: money in (up) and out (down), one button per day */}
          <div className="self-center text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
            {t("banking.days.money")}
          </div>
          {days.map((d) => {
            const cells = at(d);
            const inB = sum(cells, "inBase");
            const outB = sum(cells, "outBase");
            const rows = cells.reduce((n, c) => n + c.rows, 0);
            const toJustify = cells.reduce((n, c) => n + c.toJustify, 0);
            const on = d === selectedDay;
            const label = t("banking.days.day", {
              date: d,
              in: formatMoney(inB.toFixed(2), null),
              out: formatMoney(outB.toFixed(2), null),
              rows,
              toJustify,
            });
            return (
              <button
                type="button"
                key={d}
                title={label}
                aria-label={label}
                aria-pressed={on}
                data-day={d}
                disabled={rows === 0}
                onClick={() => onSelectDay(on ? null : d)}
                className={cn(
                  "relative flex flex-col items-stretch rounded-[3px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent",
                  on && "bg-selection ring-1 ring-primary",
                )}
                style={{ height: MONEY_HEIGHT * 2 + 1 }}
              >
                <span className="flex flex-1 items-end justify-center">
                  <span
                    className="block w-[70%] rounded-t-[2px] bg-state-done"
                    style={{ height: scale(inB) }}
                  />
                </span>
                <span className="block h-px bg-border" />
                <span className="flex flex-1 items-start justify-center">
                  <span
                    className="block w-[70%] rounded-b-[2px] bg-muted-foreground/45"
                    style={{ height: scale(outB) }}
                  />
                </span>
              </button>
            );
          })}

          {/* one row of squares per statement account */}
          {accounts.map((a) => (
            <AccountDays key={a.id} label={a.label} days={days} cellOf={(d) => at(d, a.id)[0]} />
          ))}

          {/* the day numbers: the 1st, every fifth, the last */}
          <div />
          {days.map((d, i) => {
            const n = Number(d.slice(8));
            return (
              <div
                key={d}
                data-public
                className={cn(
                  "pt-1 text-center text-[10px] tabular-nums text-muted-foreground",
                  d === selectedDay && "font-semibold text-primary",
                )}
              >
                {n === 1 || n % 5 === 0 || i === days.length - 1 ? n : ""}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AccountDays({
  label,
  days,
  cellOf,
}: {
  label: string;
  days: string[];
  cellOf: (day: string) => { rows: number; toJustify: number } | undefined;
}) {
  return (
    <>
      <div
        className="truncate pt-1.5 text-[11px] text-muted-foreground"
        title={label}
        data-testid="days-account"
      >
        {label}
      </div>
      {days.map((d) => {
        const c = cellOf(d);
        return (
          <div key={d} className="flex justify-center pt-1.5" aria-hidden>
            <span
              className={cn(
                "block h-2.5 w-full max-w-3 rounded-[3px]",
                !c || c.rows === 0
                  ? "bg-tag"
                  : c.toJustify > 0
                    ? "bg-state-attention"
                    : "bg-state-done",
              )}
            />
          </div>
        );
      })}
    </>
  );
}
