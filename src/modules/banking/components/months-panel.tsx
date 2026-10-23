"use client";

// The Months panel (F69, ui-conventions *Page anatomy* 5): one column per month from the first import to today —
// a bar (justified under to justify) and one square per account (proven / open / not imported). A click on a
// month's bar sets the table's Month filter; a second click clears it. Read only; the figures come from
// `bankMonths` (derived, never stored).
import { useEffect, useRef } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import type { BankMonthCellState, BankMonthsOverview } from "@/modules/banking/types";

const BAR_HEIGHT = 56; // px

const SQUARE: Record<BankMonthCellState, string> = {
  proven: "bg-state-done",
  open: "bg-state-attention",
  not_imported: "bg-tag",
};

const CELL_WORD = {
  proven: "banking.months.proven",
  open: "banking.months.open",
  not_imported: "banking.months.notImported",
} as const;

export function MonthsPanel({
  overview,
  selectedMonth,
  onSelectMonth,
}: {
  overview: BankMonthsOverview;
  /** the month the table's Month filter holds alone, if any */
  selectedMonth: string | null;
  /** null = clear the Month filter */
  onSelectMonth: (month: string | null) => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...overview.months.map((m) => m.justified + m.toJustify));
  const columns = `minmax(7rem, 10rem) repeat(${overview.months.length}, 1.5rem)`;

  // the newest months are the ones the owner works on: start scrolled to the right end
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const cellOf = (account: string, month: string) =>
    overview.cells.find((c) => c.bankAccountId === account && c.month === month);

  return (
    <section
      aria-label={t("banking.months.title")}
      data-testid="months-panel"
      className="rounded-md border bg-surface p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <h2 className="text-[13px] font-semibold">{t("banking.months.title")}</h2>
        <Legend colour="bg-state-done" label={t("banking.months.justified")} />
        <Legend colour="bg-state-attention" label={t("banking.months.toJustify")} />
        <span className="text-border" aria-hidden>
          |
        </span>
        <Legend colour="bg-state-done" label={t("banking.months.proven")} square />
        <Legend colour="bg-state-attention" label={t("banking.months.open")} square />
        <Legend colour="bg-tag" label={t("banking.months.notImported")} square />
        {selectedMonth && (
          <button
            type="button"
            className="ml-auto text-primary hover:underline"
            onClick={() => onSelectMonth(null)}
          >
            {t("banking.months.all")}
          </button>
        )}
      </div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="grid w-max items-end gap-x-1" style={{ gridTemplateColumns: columns }}>
          {/* row 1: the bars */}
          <div />
          {overview.months.map((m) => {
            const total = m.justified + m.toJustify;
            const selected = m.month === selectedMonth;
            const label = `${t("banking.months.bar", {
              month: m.month,
              justified: m.justified,
              toJustify: m.toJustify,
            })}${m.built ? ` · ${t("banking.months.built")}` : ""}`;
            return (
              <button
                key={m.month}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={selected}
                data-month={m.month}
                onClick={() => onSelectMonth(selected ? null : m.month)}
                className={cn(
                  "flex flex-col justify-end rounded-sm px-0.5 hover:bg-hover",
                  selected && "bg-selection ring-1 ring-primary",
                )}
                style={{ height: BAR_HEIGHT + 4 }}
              >
                {total === 0 ? (
                  <span className="block h-px w-full bg-border" />
                ) : (
                  <>
                    <span
                      className="block w-full rounded-t-[2px] bg-state-attention"
                      style={{ height: (m.toJustify / max) * BAR_HEIGHT }}
                    />
                    <span
                      className={cn(
                        "block w-full bg-state-done",
                        m.toJustify === 0 && "rounded-t-[2px]",
                      )}
                      style={{ height: (m.justified / max) * BAR_HEIGHT }}
                    />
                  </>
                )}
              </button>
            );
          })}

          {/* row 2: the month numbers, the year under January and the first column */}
          <div />
          {overview.months.map((m, i) => (
            <div
              key={m.month}
              className={cn(
                "text-center text-[11px] leading-4 tabular-nums text-muted-foreground",
                m.month === selectedMonth && "font-semibold text-primary",
              )}
            >
              {m.month.slice(5)}
              <div className="h-4 text-[10px]">
                {i === 0 || m.month.endsWith("-01") ? m.month.slice(0, 4) : ""}
              </div>
            </div>
          ))}

          {/* one row per account */}
          {overview.accounts.map((a) => (
            <AccountRow
              key={a.id}
              label={a.label}
              cells={overview.months.map((m) => {
                const state = cellOf(a.id, m.month)?.state ?? "not_imported";
                return {
                  month: m.month,
                  state,
                  title: t("banking.months.cell", {
                    account: a.label,
                    month: m.month,
                    state: t(CELL_WORD[state]),
                  }),
                };
              })}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AccountRow({
  label,
  cells,
}: {
  label: string;
  cells: { month: string; state: BankMonthCellState; title: string }[];
}) {
  return (
    <>
      <div className="truncate py-0.5 pr-2 text-xs text-muted-foreground" title={label}>
        {label}
      </div>
      {cells.map((c) => (
        <div key={c.month} className="flex justify-center py-0.5">
          <span
            role="img"
            aria-label={c.title}
            title={c.title}
            data-cell-state={c.state}
            className={cn("size-3.5 rounded-[3px]", SQUARE[c.state])}
          />
        </div>
      ))}
    </>
  );
}

function Legend({ colour, label, square }: { colour: string; label: string; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span
        className={cn("inline-block", square ? "size-2.5 rounded-[2px]" : "h-2.5 w-1.5", colour)}
        aria-hidden
      />
      {label}
    </span>
  );
}
