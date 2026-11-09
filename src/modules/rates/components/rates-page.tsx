"use client";

import { useRouter } from "next/navigation";
// The rates page (F136, spec US5; the board *Exchange rates*, D77): one card per currency against the base, the
// chart of every currency over a chosen range, *Do I have every day?* (the months from the first stored rate,
// the missing days of FR-009) and *the rate on a given day* (the nearest-day rule, US4). The figures are the
// stored ECB rates crossed through EUR (FR-011); the base is the tenant's (D39). Read only, *Fetch now* aside.
import { useAction } from "next-safe-action/hooks";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { addDays } from "@/kernel/clock/calendar";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import {
  fetchRatesNowAction,
  ratesOnDayAction,
  ratesStatusAction,
} from "@/modules/rates/rates.actions";
import type { CurrencySeries, MonthCoverage, RateOnDay } from "@/modules/rates/types";

/** a currency's colour token (D76 `--cur-*`); a currency without one is drawn in the muted text colour */
const CUR: Record<string, string> = {
  SEK: "var(--cur-sek)",
  CHF: "var(--cur-chf)",
  EUR: "var(--cur-eur)",
  USD: "var(--cur-usd)",
};
const colourOf = (c: string) => CUR[c] ?? "var(--text-muted)";

/** a rate for the eye: four decimals (the stored six stay in the tooltip of the day table) */
const show = (n: number, dp = 4) => n.toFixed(dp);
const num = (s: string) => Number(s);

const RANGES = [
  { key: "30d", days: 30 },
  { key: "90d", days: 90 },
  { key: "1y", days: 365 },
  { key: "all", days: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/** the point on or before `day` (the series are oldest first) */
function onOrBefore(points: CurrencySeries["points"], day: string) {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p && p.date <= day) return p;
  }
  return undefined;
}

// ─── Fetch now ──────────────────────────────────────────────────────────────────────────────────────────────

/** *Fetch now* (owner): queues the sync job, then refreshes the page once the newest day moved (or 30 s). */
export function FetchRatesButton({ size = "default" }: { size?: "default" | "sm" }) {
  const t = useT();
  const router = useRouter();
  const [polling, setPolling] = useState(false);
  const { executeAsync: fetchNow, isPending } = useAction(fetchRatesNowAction);
  const { executeAsync: status } = useAction(ratesStatusAction);
  const before = useRef("");

  useEffect(() => {
    if (!polling) return;
    const started = Date.now();
    const id = setInterval(async () => {
      const r = await status();
      const next = r.data && "data" in r.data ? r.data.data : null;
      const after = JSON.stringify(next?.map((s) => s.latestDate));
      const moved = !!next && after !== before.current;
      if (moved || Date.now() - started > 30_000) {
        setPolling(false);
        if (moved) {
          toast.success(t("rates.fetched"));
          router.refresh();
        }
      }
    }, 2_000);
    return () => clearInterval(id);
  }, [polling, status, router, t]);

  async function onFetch() {
    const s = await status();
    before.current = JSON.stringify(
      (s.data && "data" in s.data ? s.data.data : null)?.map((x) => x.latestDate),
    );
    const r = await fetchNow();
    const error = extractError(r);
    if (error) return toast.error(error);
    const d = r.data && "data" in r.data ? r.data.data : null;
    if (!d) return;
    toast.success(d.queued ? t("rates.queued", { count: d.lastN }) : t("rates.alreadyRunning"));
    setPolling(true);
  }

  return (
    <Button
      size={size}
      onClick={() => void onFetch()}
      disabled={isPending || polling}
      data-testid="rates-fetch"
    >
      {polling ? t("rates.fetching") : t("rates.fetchNow")}
    </Button>
  );
}

// ─── the cards and the chart ────────────────────────────────────────────────────────────────────────────────

export function RatesOverview({
  base,
  series,
  today,
}: {
  base: string;
  series: CurrencySeries[];
  today: string;
}) {
  const t = useT();
  const [range, setRange] = useState<RangeKey>("1y");
  const [off, setOff] = useState<Set<string>>(new Set());

  return (
    <div className="flex flex-col gap-4">
      {/* one card per currency: now, the inverse, 30 days and a year, the year's range */}
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3"
        data-testid="rates-cards"
      >
        {series.map((s) => {
          const last = s.points.at(-1);
          const now = last ? num(last.rate) : null;
          const ago = (days: number) => {
            const p = onOrBefore(s.points, addDays(last?.date ?? today, -days));
            return p && now ? ((now - num(p.rate)) / num(p.rate)) * 100 : null;
          };
          const year = s.points.filter((p) => p.date >= addDays(last?.date ?? today, -365));
          const lo = year.length ? Math.min(...year.map((p) => num(p.rate))) : null;
          const hi = year.length ? Math.max(...year.map((p) => num(p.rate))) : null;
          const pct = (v: number | null) =>
            v === null ? "—" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)} %`;
          return (
            <section
              key={s.currency}
              data-testid="rates-card"
              className="flex flex-col gap-1.5 pulse-card px-4 py-3.5"
              style={{ boxShadow: `inset 3px 0 0 ${colourOf(s.currency)}, var(--elev-card)` }}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  {s.currency}/{base}
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {last ? t("rates.page.asOf", { date: last.date }) : t("rates.page.noRate")}
                </span>
              </div>
              <div className="font-mono text-[26px] leading-8 font-semibold tracking-tight tabular-nums">
                {now === null ? "—" : show(now)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {now
                  ? t("rates.page.inverse", { base, rate: show(1 / now), currency: s.currency })
                  : t("rates.page.fetchFirst")}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                <span>
                  <span className="text-muted-foreground">{t("rates.page.d30")}</span>{" "}
                  {pct(ago(30))}
                </span>
                <span>
                  <span className="text-muted-foreground">{t("rates.page.y1")}</span>{" "}
                  {pct(ago(365))}
                </span>
                {lo !== null && hi !== null && (
                  <span className="text-muted-foreground">
                    {t("rates.page.range", { lo: show(lo), hi: show(hi) })}
                  </span>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* the chart: every currency against the base, one line each */}
      <section
        className="flex flex-col gap-3 pulse-card px-4 py-3.5"
        aria-label={t("rates.page.chartTitle", { base })}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-[15px] font-semibold">{t("rates.page.chartTitle", { base })}</h2>
          <div className="flex flex-wrap gap-1.5">
            {series.map((s) => {
              const on = !off.has(s.currency);
              return (
                <button
                  key={s.currency}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setOff((o) => {
                      const n = new Set(o);
                      if (n.has(s.currency)) n.delete(s.currency);
                      else n.add(s.currency);
                      return n;
                    })
                  }
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border border-subtle px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "bg-surface-2" : "text-muted-foreground opacity-60",
                  )}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: colourOf(s.currency) }}
                    aria-hidden
                  />
                  {s.currency}
                </button>
              );
            })}
          </div>
          <div className="ml-auto inline-flex gap-0.5 rounded-[10px] border border-subtle bg-surface-2 p-[3px]">
            {RANGES.map((r) => (
              <button
                type="button"
                key={r.key}
                aria-pressed={range === r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "h-7 rounded-[7px] px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  range === r.key
                    ? "bg-action font-semibold text-action-fg"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                {t(`rates.page.range.${r.key}`)}
              </button>
            ))}
          </div>
        </div>
        <RateChart
          series={series.filter((s) => !off.has(s.currency))}
          from={(() => {
            const days = RANGES.find((r) => r.key === range)?.days;
            return days ? addDays(today, -days) : null;
          })()}
        />
      </section>
    </div>
  );
}

const W = 1000;
const H = 300;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

/** The lines, hand-drawn in SVG (no chart library): a shared axis, a crosshair with the day's rates on hover. */
function RateChart({ series, from }: { series: CurrencySeries[]; from: string | null }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const shown = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        points: from ? s.points.filter((p) => p.date >= from) : s.points,
      })),
    [series, from],
  );
  const days = useMemo(
    () => [...new Set(shown.flatMap((s) => s.points.map((p) => p.date)))].sort(),
    [shown],
  );
  const values = shown.flatMap((s) => s.points.map((p) => num(p.rate)));
  if (days.length < 2 || values.length === 0)
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {t("rates.page.noData")}
      </div>
    );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || 0.1;
  const y0 = min - pad;
  const y1 = max + pad;
  const x = (i: number) => PAD.l + (i / (days.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const index = new Map(days.map((d, i) => [d, i]));
  const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  // a label every ~1/6 of the span, on the first day of a month when the span is long
  const step = Math.max(1, Math.floor(days.length / 6));
  const xLabels = days.filter((_, i) => i % step === 0);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };
  const hoverDay = hover !== null ? days[hover] : undefined;

  return (
    <div className="relative">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[300px] w-full touch-none"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("rates.page.chartLabel", { from: days[0] ?? "", to: days.at(-1) ?? "" })}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        data-testid="rates-chart"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border-subtle)"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.l - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {xLabels.map((d) => (
          <text
            key={d}
            x={x(index.get(d) ?? 0)}
            y={H - 6}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-muted)"
          >
            {d.slice(0, 7)}
          </text>
        ))}
        {shown.map((s) => (
          <polyline
            key={s.currency}
            fill="none"
            stroke={colourOf(s.currency)}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            points={s.points.map((p) => `${x(index.get(p.date) ?? 0)},${y(num(p.rate))}`).join(" ")}
          />
        ))}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="var(--text-muted)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {hoverDay && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-subtle bg-surface px-2.5 py-1.5 text-xs shadow-pop"
          style={{
            left: `${(x(hover ?? 0) / W) * 100}%`,
            transform: (hover ?? 0) > days.length / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}
        >
          <div className="mb-0.5 font-medium tabular-nums">{hoverDay}</div>
          {shown.map((s) => {
            const p = onOrBefore(s.points, hoverDay);
            return (
              <div key={s.currency} className="flex items-center gap-1.5 tabular-nums">
                <span
                  className="size-2 rounded-full"
                  style={{ background: colourOf(s.currency) }}
                  aria-hidden
                />
                {s.currency} {p ? show(num(p.rate)) : "—"}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Do I have every day? ───────────────────────────────────────────────────────────────────────────────────

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export function CoverageCard({
  months,
  missingDays,
  first,
  today,
  canFetch,
}: {
  months: MonthCoverage[];
  missingDays: string[];
  first: string | null;
  today: string;
  canFetch: boolean;
}) {
  const t = useT();
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))];
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const legend: [string, string][] = [
    ["bg-state-done/25", t("rates.page.complete")],
    ["bg-state-attention", t("rates.page.daysMissing")],
    ["bg-tag", t("rates.page.beforeFirst")],
  ];
  return (
    <section
      className="flex flex-col gap-3 pulse-card px-4 py-3.5"
      aria-label={t("rates.page.coverageTitle")}
      data-testid="rates-coverage"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">{t("rates.page.coverageTitle")}</h2>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
          {legend.map(([cls, word]) => (
            <span key={word} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", cls)} aria-hidden />
              {word}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[3rem_repeat(12,minmax(0,1fr))] gap-1 text-[11px]">
        <div />
        {MONTHS.map((m) => (
          <div key={m} className="text-center text-muted-foreground tabular-nums">
            {m}
          </div>
        ))}
        {years.map((y) => (
          <YearRow key={y} year={y} byMonth={byMonth} today={today} />
        ))}
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 text-[12.5px]",
          missingDays.length ? "bg-state-attention/12" : "bg-state-done/12",
        )}
        data-testid="rates-coverage-sentence"
      >
        <span className="min-w-0 flex-1">
          {!first
            ? t("rates.page.empty")
            : missingDays.length === 0
              ? t("rates.page.allThere", { from: first, to: today })
              : t("rates.page.missingSince", {
                  count: missingDays.length,
                  from: missingDays[0] ?? "",
                })}
        </span>
        {canFetch && (missingDays.length > 0 || !first) && <FetchRatesButton size="sm" />}
      </div>
    </section>
  );
}

function YearRow({
  year,
  byMonth,
  today,
}: {
  year: string;
  byMonth: Map<string, MonthCoverage>;
  today: string;
}) {
  const t = useT();
  return (
    <>
      <div className="self-center text-muted-foreground tabular-nums">{year}</div>
      {MONTHS.map((mm) => {
        const key = `${year}-${mm}`;
        const m = byMonth.get(key);
        const future = key > today.slice(0, 7);
        const label = !m
          ? key
          : m.beforeFirst
            ? `${key} · ${t("rates.page.beforeFirst")}`
            : m.missing
              ? `${key} · ${t("rates.page.monthMissing", { count: m.missing, of: m.weekdays })}`
              : `${key} · ${t("rates.page.complete")}`;
        return (
          <div
            key={mm}
            title={label}
            aria-label={label}
            role="img"
            data-month={key}
            data-missing={m?.missing ?? 0}
            className={cn(
              "flex h-7 items-center justify-center rounded-md tabular-nums",
              !m || future
                ? "border border-dashed border-subtle"
                : m.beforeFirst
                  ? "bg-tag"
                  : m.missing
                    ? "bg-state-attention font-semibold text-action-fg"
                    : "bg-state-done/25",
            )}
          >
            {m && !m.beforeFirst && m.missing > 0 ? m.missing : ""}
          </div>
        );
      })}
    </>
  );
}

// ─── the rate on a given day ────────────────────────────────────────────────────────────────────────────────

export function DayRatesCard({
  base,
  today,
  initial,
}: {
  base: string;
  today: string;
  initial: RateOnDay[];
}) {
  const t = useT();
  const [day, setDay] = useState(today);
  const [rows, setRows] = useState(initial);
  const { executeAsync: load, isPending } = useAction(ratesOnDayAction);

  async function pick(d: string) {
    setDay(d);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const r = await load({ date: d });
    const data = r?.data && "data" in r.data ? r.data.data : null;
    if (data) setRows(data);
    else {
      const error = extractError(r);
      if (error) toast.error(error);
    }
  }

  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return (
    <section
      className="flex flex-col gap-3 pulse-card px-4 py-3.5"
      aria-label={t("rates.page.dayTitle")}
      data-testid="rates-day"
    >
      <h2 className="text-[15px] font-semibold">{t("rates.page.dayTitle")}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="rates-day-input" className="text-xs text-muted-foreground">
          {t("rates.page.day")}
        </label>
        <DateInput
          id="rates-day-input"
          value={day}
          max={today}
          onChange={(e) => void pick(e.target.value)}
          className="w-44"
          data-testid="rates-day-input"
        />
        <span className="text-xs text-muted-foreground">
          {weekday === 0 || weekday === 6 ? t("rates.page.weekend") : t("rates.page.weekday")}
        </span>
      </div>
      <table className={cn("w-full text-[13px]", isPending && "opacity-60")}>
        <thead>
          <tr className="border-b border-border text-left text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
            <th className="py-2 font-medium">{t("rates.page.col.currency")}</th>
            <th className="py-2 text-right font-medium">{t("rates.page.col.perUnit", { base })}</th>
            <th className="py-2 pl-4 font-medium">{t("rates.page.col.from")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.currency} className="border-b border-subtle" data-testid="rates-day-row">
              <td className="py-2.5">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: colourOf(r.currency) }}
                    aria-hidden
                  />
                  {r.currency}
                </span>
              </td>
              <td
                className="py-2.5 text-right font-mono font-semibold tabular-nums"
                title={r.rate ?? ""}
              >
                {r.rate ? show(num(r.rate)) : "—"}
              </td>
              <td className="py-2.5 pl-4 text-xs text-muted-foreground tabular-nums">
                {r.rate === null
                  ? t("rates.page.noRateNear")
                  : r.source === "ecb_nearest"
                    ? t("rates.page.borrowed", { date: r.rateDate ?? "" })
                    : t("rates.page.sameDay")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">{t("rates.page.nearestNote")}</p>
    </section>
  );
}
