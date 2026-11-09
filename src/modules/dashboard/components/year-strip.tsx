"use client";

// The year, week by week (F158, the Pulse board): fifty-two columns — the money in (up) and out (down) of the
// statement accounts in the base on top, one square per account under it (done · open · late · nothing that week).
// A column is a button: it shows its week on the right (the range, in and out, the rows still to justify) with the
// way into Banking filtered to that week. Derived on request (`yearWeeks`), read only.
import Link from "next/link";
import { useState } from "react";
import { formatMonth } from "@/kernel/i18n/format-date";
import { useLocale } from "@/kernel/i18n/locale-provider";
import { uiLanguage } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import type { WeekCellState, YearWeeks } from "@/modules/dashboard/year-weeks";

const MONEY = 40;
const CELL: Record<WeekCellState, string> = {
  done: "bg-state-done",
  open: "bg-state-attention",
  late: "bg-destructive",
  none: "bg-border/60",
};

export function YearStrip({ data, base }: { data: YearWeeks; base: string }) {
  const t = useT();
  const { effectiveLocale } = useLocale();
  const lang = uiLanguage(effectiveLocale ?? null);
  const { weeks, accounts } = data;
  const lastWithRows = [...weeks].reverse().find((w) => w.rows > 0) ?? weeks.at(-1) ?? null;
  const [selected, setSelected] = useState<string | null>(lastWithRows?.from ?? null);
  const week = weeks.find((w) => w.from === selected) ?? null;
  const max = Math.max(1, ...weeks.map((w) => Math.max(Number(w.inBase), Number(w.outBase))));
  // a square-root scale, as the day strip: one large transfer does not flatten the year
  const h = (v: string) => (Number(v) > 0 ? Math.max(2, Math.sqrt(Number(v) / max) * MONEY) : 0);
  if (accounts.length === 0) return null;

  return (
    <section
      className="pulse-card flex min-w-0 flex-col gap-4 px-6 py-5"
      data-testid="home-year"
      aria-label={t("home.year.title")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold">
          {t("home.year.title")}
          <span className="text-xs font-normal text-muted-foreground">
            {t("home.year.sub", { base })}
          </span>
        </h2>
        <ul className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {(["done", "open", "late", "none"] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-sm", CELL[s])} aria-hidden />
              {t(`home.year.state.${s}`)}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 overflow-x-auto">
          <div
            className="grid min-w-[44rem] gap-x-[3px]"
            style={{ gridTemplateColumns: `7rem repeat(${weeks.length}, minmax(0, 1fr))` }}
          >
            {/* the money: in above the line, out below */}
            <span className="row-span-2 self-center text-[11px] text-muted-foreground">
              {t("home.year.in")}
              <br />
              {t("home.year.out")}
            </span>
            {weeks.map((w) => (
              <button
                key={w.from}
                type="button"
                onClick={() => setSelected(w.from)}
                aria-pressed={w.from === selected}
                aria-label={t("home.year.week", { number: w.number, from: w.from, to: w.to })}
                className={cn(
                  "row-span-2 flex flex-col items-center rounded-sm",
                  w.from === selected ? "bg-selection" : "hover:bg-hover",
                )}
                style={{ height: MONEY * 2 + 4 }}
                data-testid="home-year-week"
              >
                <span className="flex h-10 w-full items-end justify-center">
                  <span
                    className="w-1.5 rounded-t-sm bg-state-done/70"
                    style={{ height: h(w.inBase) }}
                  />
                </span>
                <span className="h-px w-full bg-border" />
                <span className="flex h-10 w-full items-start justify-center">
                  <span
                    className="w-1.5 rounded-b-sm bg-foreground/40"
                    style={{ height: h(w.outBase) }}
                  />
                </span>
              </button>
            ))}
            <span className="col-span-full h-2" />
            {/* the squares: one row per statement account */}
            {accounts.map((a, i) => (
              <div key={a.id} className="contents">
                <span className="truncate pr-2 text-[11px] leading-[14px] text-muted-foreground">
                  {a.label}
                </span>
                {weeks.map((w) => (
                  <span
                    key={w.from}
                    className={cn(
                      "my-[2px] h-[10px] rounded-[2px]",
                      CELL[w.cells[i] ?? "none"],
                      w.from === selected && "ring-1 ring-foreground/50",
                    )}
                    data-state={w.cells[i]}
                  />
                ))}
              </div>
            ))}
            {/* the months under the first week of each */}
            <span />
            {weeks.map((w, i) => {
              const m = w.from.slice(5, 7);
              const first = i === 0 || weeks[i - 1]?.from.slice(5, 7) !== m;
              return (
                <span
                  key={w.from}
                  className="pt-1 text-[10px] whitespace-nowrap text-muted-foreground"
                >
                  {first ? formatMonth(w.from.slice(0, 7), lang, "short").split(" ")[0] : ""}
                </span>
              );
            })}
          </div>
        </div>

        {week && (
          <aside
            className="flex flex-col gap-3 rounded-xl border border-subtle bg-surface-2 p-4"
            data-testid="home-year-detail"
          >
            <span className="eyebrow">{t("home.year.weekNumber", { number: week.number })}</span>
            <span className="text-[17px] font-semibold tabular-nums">
              {week.from} → {week.to}
            </span>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">{t("home.year.in")}</dt>
                <dd className="text-[13px] font-semibold tabular-nums">
                  {formatMoney(week.inBase, base, { whole: true })}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("home.year.out")}</dt>
                <dd className="text-[13px] font-semibold tabular-nums">
                  {formatMoney(week.outBase, base, { whole: true })}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {week.rows === 0
                ? t("home.year.noRows")
                : week.toJustify > 0
                  ? t("home.year.toJustify", { count: week.toJustify, rows: week.rows })
                  : t("home.year.allJustified", { rows: week.rows })}
            </p>
            {week.rows > 0 && (
              <Link
                href={`/banking?f.bookingDate=${encodeURIComponent(`dates:from=${week.from}|to=${week.to}`)}`}
                className="mt-auto rounded-lg border border-border bg-surface px-3 py-1.5 text-center text-[13px] font-medium hover:bg-hover"
                data-testid="home-year-open"
              >
                {t("home.year.open")}
              </Link>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
