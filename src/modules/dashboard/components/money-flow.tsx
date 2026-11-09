"use client";

// Where the year's money went (F167, the board *Pulse*'s flow): the clients on the left, the year in the middle, the
// costs and what is kept on the right; each band as thick as its money. Hand-drawn SVG (no chart library): stacked
// nodes, cubic bands between them, a label beside each node. The figures are `moneyFlow`'s.
import { useT } from "@/kernel/i18n/use-t";
import { formatMoneyCompact } from "@/kernel/money/format-money";
import { PulseSection } from "@/kernel/ui/pulse";
import type { MoneyFlow as Flow } from "@/modules/dashboard/types";

const W = 760;
const H = 320;
const NODE = 12;
const GAP = 8;
const X = { left: 150, mid: 372, right: 594 };
const IN = [
  "var(--cur-eur)",
  "var(--cur-sek)",
  "var(--state-progress)",
  "var(--cur-usd)",
  "var(--text-muted)",
];
const OUT = [
  "var(--cur-chf)",
  "var(--state-attention)",
  "var(--cur-usd)",
  "var(--destructive)",
  "var(--text-muted)",
  "var(--cur-eur)",
];

type Part = { label: string; value: number; color: string };

/** stacks parts top to bottom over `scale` px per unit, a gap between them */
function stack(parts: Part[], scale: number, top: number) {
  let y = top;
  return parts.map((p) => {
    // a small part keeps room for its label
    const h = Math.max(14, p.value * scale);
    const node = { ...p, y, h };
    y += h + GAP;
    return node;
  });
}

const band = (x0: number, y0: number, x1: number, y1: number, h: number) => {
  const c = (x0 + x1) / 2;
  return `M${x0},${y0} C${c},${y0} ${c},${y1} ${x1},${y1} L${x1},${y1 + h} C${c},${y1 + h} ${c},${y0 + h} ${x0},${y0 + h} Z`;
};

export function MoneyFlowCard({ flow, base }: { flow: Flow; base: string }) {
  const t = useT();
  const name = (l: string) =>
    l === "others" ? t("home.flow.others") : l === "expenses" ? t("home.flow.expenses") : l;
  const income: Part[] = flow.income.map((p, i) => ({
    label: name(p.label),
    value: Number(p.base),
    color: IN[i % IN.length] as string,
  }));
  const kept = Number(flow.kept);
  const costs: Part[] = [
    ...flow.costs.map((p, i) => ({
      label: name(p.label),
      value: Number(p.base),
      color: OUT[i % OUT.length] as string,
    })),
    ...(kept > 0 ? [{ label: t("home.flow.kept"), value: kept, color: "var(--state-done)" }] : []),
  ];
  const totalIn = income.reduce((s, p) => s + p.value, 0);
  const totalOut = costs.reduce((s, p) => s + p.value, 0);
  if (totalIn <= 0 && totalOut <= 0) return null;
  const big = Math.max(totalIn, totalOut);
  const slots = Math.max(income.length, costs.length);
  const scale = (H - 24 - GAP * (slots - 1) - 14 * slots) / big;
  const left = stack(income, scale, 12);
  const right = stack(costs, scale, 12);
  const midH = big * scale;

  // the bands: each income into the middle, top-aligned; the middle out to each cost
  let inY = 12;
  let outY = 12;
  return (
    <PulseSection
      title={t("home.flow.title", { year: flow.year })}
      sub={t("home.flow.sub", { base })}
      testId="home-flow"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("home.flow.title", { year: flow.year })}
      >
        {left.map((n) => {
          const d = band(X.left + NODE, n.y, X.mid, inY, n.h);
          inY += n.h;
          return <path key={`in-${n.label}`} d={d} fill={n.color} opacity="0.28" />;
        })}
        {right.map((n) => {
          const d = band(X.mid + NODE, outY, X.right, n.y, n.h);
          outY += n.h;
          return <path key={`out-${n.label}`} d={d} fill={n.color} opacity="0.28" />;
        })}
        <rect x={X.mid} y={12} width={NODE} height={midH} rx="3" fill="var(--text)" opacity="0.8" />
        <text
          x={X.mid + NODE / 2}
          y={H - 2}
          textAnchor="middle"
          fontSize="12"
          fill="var(--text-muted)"
        >
          {flow.year}
        </text>
        {left.map((n) => (
          <g key={`ln-${n.label}`}>
            <rect x={X.left} y={n.y} width={NODE} height={n.h} rx="3" fill={n.color} />
            <text
              x={X.left - 8}
              y={n.y + n.h / 2 + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--text)"
            >
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
              <tspan fill="var(--text-muted)"> {formatMoneyCompact(n.value.toFixed(2))}</tspan>
            </text>
          </g>
        ))}
        {right.map((n) => (
          <g key={`rn-${n.label}`}>
            <rect x={X.right} y={n.y} width={NODE} height={n.h} rx="3" fill={n.color} />
            <text x={X.right + NODE + 8} y={n.y + n.h / 2 + 4} fontSize="12" fill="var(--text)">
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
              <tspan fill="var(--text-muted)"> {formatMoneyCompact(n.value.toFixed(2))}</tspan>
            </text>
          </g>
        ))}
      </svg>
      {kept < 0 && (
        <p className="text-xs text-state-attention">
          {t("home.flow.short", { amount: formatMoneyCompact((-kept).toFixed(2), base) })}
        </p>
      )}
    </PulseSection>
  );
}
