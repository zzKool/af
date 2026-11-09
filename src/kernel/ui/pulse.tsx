// The Pulse kit (D76, F163 — the boards *Pulse*, *Partner*, *Banking*): the pieces every page builds its ground from,
// so a page without a board of its own still reads like the boards. Server-friendly (no hooks): a hero with its big
// number and its sentence, a row of KPI tiles, a section card, the table's card, twelve months as bars, a share as
// one stacked bar with its legend, a spark line. Colours only through tokens; figures `tabular-nums`; money arrives
// formatted (the caller picks `formatMoney` / `formatMoneyCompact`).
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PulseTone = "done" | "attention" | "danger" | "progress" | "neutral";

const TEXT: Record<PulseTone, string> = {
  done: "text-state-done",
  attention: "text-state-attention",
  danger: "text-destructive",
  progress: "text-state-progress",
  neutral: "text-foreground",
};
const CHIP: Record<PulseTone, string> = {
  done: "bg-state-done/12 text-state-done",
  attention: "bg-state-attention/12 text-state-attention",
  danger: "bg-destructive/10 text-destructive",
  progress: "bg-state-progress/12 text-state-progress",
  neutral: "bg-tag text-muted-foreground",
};
export const BAR: Record<PulseTone, string> = {
  done: "bg-state-done",
  attention: "bg-state-attention",
  danger: "bg-destructive",
  progress: "bg-state-progress",
  neutral: "bg-foreground/25",
};

/** a strong word in a sentence, coloured by what it says (*Two things are late*) */
export function Emph({ tone = "neutral", children }: { tone?: PulseTone; children: ReactNode }) {
  return <strong className={cn("font-semibold", TEXT[tone])}>{children}</strong>;
}

/** a small rounded chip — a delta, a count, a due day */
export function PulseChip({
  tone = "neutral",
  children,
  testId,
}: {
  tone?: PulseTone;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold whitespace-nowrap tabular-nums",
        CHIP[tone],
      )}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/** values → an SVG path over `w` × `h` (nulls skipped); empty when fewer than two points */
export function sparkPath(values: readonly (number | null)[], w: number, h: number): string {
  const pts = values
    .map((v, i) => (v === null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p !== null);
  if (pts.length < 2) return "";
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const step = w / Math.max(1, values.length - 1);
  return pts
    .map(
      (p, n) =>
        `${n === 0 ? "M" : "L"}${(p.i * step).toFixed(1)},${(h - 2 - ((p.v - lo) / span) * (h - 4)).toFixed(1)}`,
    )
    .join(" ");
}

export function Spark({
  values,
  className,
  label,
}: {
  values: readonly (number | null)[];
  className?: string;
  label?: string;
}) {
  const d = sparkPath(values, 220, 34);
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 220 34"
      className={cn("h-[34px] w-[220px] text-action", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The page's hero (the board *Pulse*'s cash card): an eyebrow, the big number with its unit, a chip and a spark
 * under it, one sentence that says where things stand, and a right column (a ring, a breakdown) when given.
 */
export function PulseHero({
  eyebrow,
  value,
  unit,
  chip,
  spark,
  sentence,
  children,
  aside,
  testId,
}: {
  eyebrow: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  chip?: ReactNode;
  spark?: readonly (number | null)[];
  sentence?: ReactNode;
  /** under the sentence: a KPI line, a breakdown */
  children?: ReactNode;
  aside?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="pulse-card flex min-w-0 flex-wrap items-center gap-x-8 gap-y-5 px-7 py-6"
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
        <div className="eyebrow">{eyebrow}</div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span
            className="text-[clamp(2.5rem,5.4vw,4.5rem)] leading-[0.95] font-semibold tracking-[-0.045em] tabular-nums"
            data-testid={testId ? `${testId}-value` : undefined}
          >
            {value}
          </span>
          {unit && <span className="text-[22px] text-muted-foreground">{unit}</span>}
        </div>
        {(chip || spark) && (
          <div className="flex flex-wrap items-center gap-3.5">
            {chip}
            {spark && <Spark values={spark} />}
          </div>
        )}
        {sentence && (
          <p className="m-0 max-w-[620px] text-[17px] leading-normal font-light text-foreground/85">
            {sentence}
          </p>
        )}
        {children}
      </div>
      {aside && <div className="flex min-w-0 flex-[0_1_420px] flex-col gap-3">{aside}</div>}
    </section>
  );
}

/** the eyebrow figures under a hero's sentence (*INVOICED 2026 · COSTS · RESULT*) */
export function HeroFigures({
  items,
}: {
  items: { label: ReactNode; value: ReactNode; tone?: PulseTone; testId?: string }[];
}) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-subtle pt-3">
      {items.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered set of figures
        <div key={i} className="flex flex-col gap-0.5" data-testid={m.testId}>
          <dt className="eyebrow">{m.label}</dt>
          <dd className={cn("text-lg font-semibold tabular-nums", TEXT[m.tone ?? "neutral"])}>
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function KpiRow({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="grid gap-[18px] sm:grid-cols-2 xl:grid-cols-4" data-testid={testId}>
      {children}
    </div>
  );
}

/** one KPI tile (the board *Partner*): the eyebrow, the figure large, one line under it */
export function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: PulseTone;
  href?: string;
  testId?: string;
}) {
  const body = (
    <>
      <span className="eyebrow">{label}</span>
      <span className={cn("text-[26px] leading-tight font-semibold tabular-nums", TEXT[tone])}>
        {value}
      </span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </>
  );
  const cls = "pulse-card flex min-w-0 flex-col gap-1 px-5 py-4";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:bg-hover")} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <section className={cls} data-testid={testId}>
      {body}
    </section>
  );
}

/** a section of the page as its card: the title 15/600, one muted line beside it, actions right */
export function PulseSection({
  title,
  sub,
  actions,
  children,
  className,
  testId,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn("pulse-card flex min-w-0 flex-col gap-3 px-5 py-4", className)}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** the list's own card on the ground (D76): the DataTable sits in it */
export function TableCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <section className="pulse-card min-w-0 px-2 pt-3 pb-2" data-testid={testId}>
      {children}
    </section>
  );
}

/**
 * Months as bars (the board *Partner*'s *Invoiced and paid, by month*): one column per month, the bar's height its
 * share of the largest, a label over it, the month under it; a tone per bar (open months amber).
 */
export function MonthBars({
  bars,
  testId,
}: {
  bars: { key: string; label: ReactNode; value: number; top?: ReactNode; tone?: PulseTone }[];
  testId?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  return (
    <ol
      className="grid h-44 items-end gap-1.5"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, bars.length)}, minmax(0, 1fr))` }}
      data-testid={testId}
    >
      {bars.map((b) => (
        <li key={b.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
          <span className="h-4 truncate text-[10.5px] text-muted-foreground tabular-nums">
            {b.top}
          </span>
          <span
            className={cn("w-full max-w-9 rounded-t-md", BAR[b.tone ?? "progress"])}
            style={{
              height: `${b.value === 0 ? 2 : Math.max(4, (Math.abs(b.value) / max) * 118)}px`,
            }}
            aria-hidden
          />
          <span className="text-[11px] text-muted-foreground">{b.label}</span>
        </li>
      ))}
    </ol>
  );
}

const SEGMENT = [
  "var(--cur-sek)",
  "var(--cur-chf)",
  "var(--cur-eur)",
  "var(--cur-usd)",
  "var(--state-progress)",
  "var(--text-muted)",
];

/** a whole split in parts (the board *Pulse*'s *CHF account 57 % · Savings 22 %*): one bar, a legend with shares */
export function StackBar({
  parts,
  testId,
}: {
  parts: { key: string; label: ReactNode; value: number; detail?: ReactNode }[];
  testId?: string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((p, i) => (
          <span
            key={p.key}
            style={{ flexGrow: Math.max(0, p.value), background: SEGMENT[i % SEGMENT.length] }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p, i) => (
          <li key={p.key} className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-sm"
              style={{ background: SEGMENT[i % SEGMENT.length] }}
              aria-hidden
            />
            <span className="truncate">{p.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {Math.round((Math.max(0, p.value) / total) * 100)} %
            </span>
            {p.detail && <span className="text-muted-foreground tabular-nums">· {p.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** a ring: the share done of a whole (the board's *87 % of 2026 justified*) */
export function Ring({
  percent,
  label,
  sub,
  tone = "done",
  testId,
}: {
  percent: number;
  label?: ReactNode;
  sub?: ReactNode;
  tone?: PulseTone;
  testId?: string;
}) {
  const C = 2 * Math.PI * 80;
  const p = Math.max(0, Math.min(100, percent));
  const stroke: Record<PulseTone, string> = {
    done: "stroke-state-done",
    attention: "stroke-state-attention",
    danger: "stroke-destructive",
    progress: "stroke-state-progress",
    neutral: "stroke-foreground/40",
  };
  return (
    <div className="relative size-[168px] shrink-0" data-testid={testId}>
      <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          strokeWidth="18"
          className="stroke-surface-2"
        />
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          strokeWidth="18"
          strokeLinecap="round"
          className={stroke[tone]}
          strokeDasharray={`${(C * p) / 100} ${C}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[38px] leading-none font-semibold tracking-tight tabular-nums">
          {label ?? `${Math.round(p)}%`}
        </span>
        {sub && <span className="mt-1 text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
