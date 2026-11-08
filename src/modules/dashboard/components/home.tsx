"use client";

// Home — the year at a glance (F138, spec US5; the board *Pulse*, D77): the cash hero with its month and twelve
// months, the situation sentence, the year's figures and ring; the next moves with the close's line; the currencies
// against the base and what the company holds in them. Everything is computed by `homeData` (FR-006 – FR-008);
// these components only draw. Money through `formatMoney`, colours through tokens (the currencies' own --cur-*).
import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { formatMonth } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { StateIcon } from "@/kernel/ui/state-label";
import { cn } from "@/lib/utils";
import type {
  ActionItem,
  CashSummary,
  CurrencyTicker,
  PulseMetric,
  WorkData,
} from "@/modules/dashboard/types";
import { PRIORITY_FAMILY } from "../priority-family";

const CARD = "rounded-2xl border border-subtle bg-surface shadow-card";
const EYEBROW = "text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase";
/** the moves shown before *Show the other N* */
const MOVES = 3;

/** a currency's colour token (D76: --cur-sek / chf / eur / usd), neutral for any other */
const curColor = (currency: string) =>
  ["sek", "chf", "eur", "usd"].includes(currency.toLowerCase())
    ? `var(--cur-${currency.toLowerCase()})`
    : "var(--state-neutral)";

/** An SVG path through `values` (nulls skipped) in a w × h box. */
function sparkPath(values: (number | null)[], w: number, h: number): string {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    const x = (i * step).toFixed(1);
    const y = (h - 2 - ((v - min) / span) * (h - 4)).toFixed(1);
    d += d ? ` L${x} ${y}` : `M${x} ${y}`;
  });
  return d;
}

export function CashHero({
  cash,
  sentence,
  metrics,
  year,
}: {
  cash: CashSummary;
  sentence: string;
  metrics: PulseMetric[];
  year: { year: string; justified: number; toJustify: number };
}) {
  const t = useT();
  const delta = cash.monthDelta ? Number(cash.monthDelta) : null;
  const trend = sparkPath(
    cash.series.map((s) => (s.total === null ? null : Number(s.total))),
    220,
    34,
  );
  const rows = year.justified + year.toJustify;
  const percent = rows > 0 ? Math.floor((year.justified / rows) * 100) : 0;
  const C = 2 * Math.PI * 80;
  return (
    <section
      className={cn(CARD, "flex min-w-0 flex-[7_1_560px] flex-wrap items-center gap-7 px-7 py-6")}
      data-testid="home-cash"
    >
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
        <div className={EYEBROW}>{t("home.cash.eyebrow", { base: cash.base })}</div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span
            className="text-[clamp(2.75rem,6vw,4.75rem)] leading-[0.95] font-semibold tracking-[-0.045em] tabular-nums"
            data-testid="home-cash-total"
          >
            {formatMoney(cash.total, null)}
          </span>
          <span className="text-[22px] text-muted-foreground">{cash.base}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          {delta !== null && (
            <span
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold tabular-nums",
                delta >= 0
                  ? "bg-state-done/12 text-state-done"
                  : "bg-state-attention/12 text-state-attention",
              )}
              data-testid="home-cash-month"
            >
              {delta >= 0 ? "▲" : "▼"}{" "}
              {t("home.cash.month", {
                delta: formatMoney((cash.monthDelta ?? "0").replace(/^-/, ""), null),
              })}
            </span>
          )}
          {trend && (
            <svg
              viewBox="0 0 220 34"
              className="h-[34px] w-[220px] text-action"
              role="img"
              aria-label={t("home.cash.trend")}
            >
              <path
                d={trend}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          )}
          {cash.incomplete && (
            <span className="text-xs text-muted-foreground">{t("home.cash.incomplete")}</span>
          )}
        </div>
        <p className="m-0 max-w-[560px] text-[17px] leading-normal font-light text-foreground/85">
          {sentence}
        </p>
        <dl
          className="flex flex-wrap gap-x-8 gap-y-2 border-t border-subtle pt-3"
          data-testid="business-pulse"
        >
          {metrics.map((m) => (
            <div
              key={m.id}
              className="flex flex-col gap-0.5"
              data-testid="pulse-metric"
              data-kind={m.kind}
            >
              <dt className={EYEBROW}>
                {m.kind === "balance" ? m.label : t(`dashboard.pulse.${m.kind}`)}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                <Link href={m.href} className="hover:text-action">
                  {formatMoney(m.value, m.currency)}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {rows > 0 && (
        <div
          className="flex flex-[0_0_168px] flex-col items-center gap-2.5"
          data-testid="home-ring"
        >
          <svg
            viewBox="0 0 200 200"
            className="size-[168px]"
            role="img"
            aria-label={t("home.ring.label", {
              year: year.year,
              justified: year.justified,
              open: year.toJustify,
            })}
          >
            <circle
              cx="100"
              cy="100"
              r="80"
              fill="none"
              strokeWidth="16"
              className="stroke-surface-2"
            />
            <circle
              cx="100"
              cy="100"
              r="80"
              fill="none"
              strokeWidth="16"
              strokeLinecap="round"
              className="stroke-state-attention"
              strokeDasharray={`${C} ${C}`}
              transform="rotate(-90 100 100)"
            />
            {year.justified > 0 && (
              <circle
                cx="100"
                cy="100"
                r="80"
                fill="none"
                strokeWidth="16"
                strokeLinecap="round"
                className="stroke-state-done"
                strokeDasharray={`${(C * year.justified) / rows} ${C}`}
                transform="rotate(-90 100 100)"
              />
            )}
            <text
              x="100"
              y="104"
              textAnchor="middle"
              className="fill-foreground text-[44px] font-semibold"
            >
              {percent}%
            </text>
            <text x="100" y="128" textAnchor="middle" className="fill-muted-foreground text-[12px]">
              {year.year}
            </text>
          </svg>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-state-done" aria-hidden />
              {t("home.ring.done")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-state-attention" aria-hidden />
              {t("home.ring.open")}
            </span>
          </div>
          <span className="sr-only">{t("home.ring", { percent, year: year.year })}</span>
        </div>
      )}
    </section>
  );
}

function MoveText({ item }: { item: ActionItem }) {
  const t = useT();
  return (
    <>
      {t(`dashboard.action.${item.kind}`, {
        count: item.count,
        period: item.period ?? "",
        ...item.params,
      })}
    </>
  );
}

export function NextMoves({ items, work }: { items: ActionItem[]; work: WorkData | null }) {
  const t = useT();
  const lang = useUiLanguage();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, MOVES);
  const close = work?.close ?? null;
  const rows = close ? close.rows.justified + close.rows.toJustify : 0;
  return (
    <section
      className={cn(CARD, "flex min-w-0 flex-[5_1_400px] flex-col gap-3 p-[22px]")}
      data-testid="action-items"
    >
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-lg font-semibold tracking-tight">{t("home.moves.title")}</h2>
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("home.moves.sub", { shown: shown.length, count: items.length })}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("home.moves.none")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {shown.map((item, i) => (
            <li
              key={item.id}
              data-testid="action-item"
              data-kind={item.kind}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-subtle px-3 py-2.5",
                i === 0 && "bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                  item.priority === "high"
                    ? "bg-state-attention/15 text-state-attention"
                    : "bg-surface-2 text-muted-foreground",
                )}
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  <MoveText item={item} />
                </div>
                {item.amount && (
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatMoney(item.amount.value, item.amount.currency)}
                  </div>
                )}
              </div>
              <StateIcon family={PRIORITY_FAMILY[item.priority]} />
              <Link
                href={item.href}
                className={buttonVariants({ variant: i === 0 ? "default" : "outline", size: "sm" })}
              >
                {t("home.moves.open")}
              </Link>
            </li>
          ))}
        </ol>
      )}
      {items.length > MOVES && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="self-start text-xs font-medium text-action hover:underline"
          data-testid="home-moves-more"
        >
          {all ? t("home.moves.less") : t("home.moves.more", { count: items.length - MOVES })}
        </button>
      )}
      {close && work && (
        <Link
          href="/work"
          className="mt-auto flex flex-col gap-1.5 rounded-lg pt-1.5 hover:opacity-90"
          data-testid="home-close"
          aria-label={t("home.close.open")}
        >
          <span className="flex items-center gap-3">
            <span
              className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
              aria-hidden
            >
              <i className="block bg-state-done" style={{ width: `${close.percent}%` }} />
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {rows > 0
                ? t("home.close.line", {
                    month: formatMonth(close.month, lang),
                    done: close.rows.justified,
                    total: rows,
                  })
                : t("home.close.lineEmpty", {
                    month: formatMonth(close.month, lang),
                    percent: close.percent,
                  })}
            </span>
          </span>
          {work.streak > 0 && (
            <span className="text-xs text-state-done" data-testid="home-streak">
              {t("home.close.streak", { count: work.streak })}
            </span>
          )}
        </Link>
      )}
    </section>
  );
}

export function CurrenciesCard({
  cash,
  tickers,
  days,
}: {
  cash: CashSummary;
  tickers: CurrencyTicker[];
  days: number;
}) {
  const t = useT();
  const held = cash.accounts.filter((a) => a.share > 0);
  const top = cash.exposure[0];
  return (
    <section
      className={cn(CARD, "flex min-w-0 flex-[5_1_400px] flex-col gap-3.5 p-[22px]")}
      data-testid="home-currencies"
    >
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-lg font-semibold tracking-tight">{t("home.fx.title")}</h2>
        <span className="text-xs text-muted-foreground">
          {t("home.fx.sub", { base: cash.base, days })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {tickers.map((x) => {
          const path = sparkPath(
            x.points.map((p) => Number(p)),
            120,
            30,
          );
          return (
            <Link
              key={x.currency}
              href="/rates"
              className="flex min-w-[7.5rem] flex-1 flex-col gap-1 rounded-xl border border-subtle bg-surface-2 px-3 py-2.5 hover:border-border"
              data-testid="home-ticker"
              data-currency={x.currency}
            >
              <span className="flex items-center gap-1.5">
                <i
                  className="block size-2 rounded-full"
                  style={{ background: curColor(x.currency) }}
                  aria-hidden
                />
                <span className="font-mono text-xs text-muted-foreground">{x.currency}</span>
                {x.change !== null && (
                  <span
                    className={cn(
                      "ml-auto text-[11.5px] font-semibold tabular-nums",
                      x.change >= 0 ? "text-state-done" : "text-state-attention",
                    )}
                  >
                    {x.change >= 0 ? "+" : "−"}
                    {Math.abs(x.change).toFixed(1)} %
                  </span>
                )}
              </span>
              <span className="font-mono text-[22px] font-medium tracking-tight tabular-nums">
                {x.now ? Number(x.now).toFixed(4) : t("home.fx.none")}
              </span>
              {path && (
                <svg
                  viewBox="0 0 120 30"
                  preserveAspectRatio="none"
                  className="h-[30px] w-full"
                  aria-hidden
                >
                  <path
                    d={path}
                    fill="none"
                    stroke={curColor(x.currency)}
                    strokeWidth="1.6"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
            </Link>
          );
        })}
      </div>
      {held.length > 0 && (
        <div
          className="flex flex-col gap-2.5 rounded-xl border border-subtle bg-surface-2 p-3.5"
          data-testid="home-exposure"
        >
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {held.map((a) => (
              <i
                key={a.label}
                className="block h-full"
                style={{ width: `${a.share}%`, background: curColor(a.currency) }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
            {held.map((a) => (
              <span key={a.label} className="inline-flex items-center gap-1.5">
                <i
                  className="block size-2 rounded-full"
                  style={{ background: curColor(a.currency) }}
                  aria-hidden
                />
                {t("home.fx.share", { account: a.label, share: a.share })}
              </span>
            ))}
          </div>
          <div className="text-[12.5px] text-foreground/85">
            {top
              ? t("home.fx.move", {
                  currency: top.currency,
                  base: cash.base,
                  amount: formatMoney(top.onePercent, cash.base),
                })
              : t("home.fx.noForeign", { base: cash.base })}
          </div>
        </div>
      )}
    </section>
  );
}
