"use client";

// The neighbourhood of one entity (specs/linking, graph read model): a radial picture — the root in the centre,
// one ring per hop, edges labelled by kind — and, beside it, the same nodes as a list with *Graph* (re-root)
// and *Open* (the entity's own page). The list is the accessible form; the picture is decoration for the eye.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { cn } from "@/lib/utils";
import { layoutGraph, shortLabel } from "@/modules/linking/graph-layout";
import { entityHref, graphHref } from "@/modules/linking/hrefs";
import type { Graph, GraphNode, LinkableType } from "@/modules/linking/types";

const NODE_FILL: Record<LinkableType, string> = {
  document: "fill-slate-500",
  partner: "fill-violet-500",
  contract: "fill-fuchsia-500",
  bank_transaction: "fill-emerald-500",
  journal_entry: "fill-teal-500",
  invoice: "fill-sky-500",
  supplier_invoice: "fill-orange-500",
  expense: "fill-amber-500",
  settlement: "fill-rose-500",
};

const NODE_R = 7;

export function LinkGraph({ graph }: { graph: Graph }) {
  const t = useT();
  const router = useRouter();
  const { positions, extent } = useMemo(() => layoutGraph(graph), [graph]);
  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const rings = useMemo(() => {
    const out = new Map<number, GraphNode[]>();
    for (const n of graph.nodes) out.set(n.depth, [...(out.get(n.depth) ?? []), n]);
    return [...out.entries()].sort(([a], [b]) => a - b);
  }, [graph]);
  const amountOf = (n: GraphNode) =>
    n.amount && n.currency
      ? `${formatCurrency(n.amount, n.currency as Currency)} ${n.currency}`
      : null;
  const side = extent * 2;
  // the picture is scaled to its box: deeper graphs get larger glyphs so the text stays legible
  const k = Math.max(1, side / 800);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <figure className="min-w-0 overflow-auto rounded-lg border bg-background p-2">
        {/* the list beside it carries the same nodes for keyboard and screen-reader users */}
        <svg
          viewBox={`${-extent} ${-extent} ${side} ${side}`}
          className="mx-auto block w-full"
          style={{ height: Math.min(600, side), fontSize: 13 * k }}
          aria-hidden="true"
          data-testid="link-graph"
        >
          {graph.edges.map((e) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            const nf = byKey.get(e.from);
            const nt = byKey.get(e.to);
            const tree = nf?.parent === e.to || nt?.parent === e.from;
            // the label sits 60 % of the way out from the shallower end — away from the crowded centre
            const [near, far] = (nf?.depth ?? 0) <= (nt?.depth ?? 0) ? [a, b] : [b, a];
            const lx = near.x + (far.x - near.x) * 0.6;
            const ly = near.y + (far.y - near.y) * 0.6;
            const label = [
              t(`linking.kind.${e.kind}`),
              e.allocatedAmount && e.currency
                ? `${formatCurrency(e.allocatedAmount, e.currency as Currency)} ${e.currency}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <g key={e.id} className="stroke-border">
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  strokeWidth={(tree ? 1.5 : 1) * k}
                  strokeDasharray={tree ? undefined : "4 3"}
                />
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-muted-foreground stroke-background"
                  strokeWidth={4 * k}
                  paintOrder="stroke"
                >
                  {label}
                </text>
              </g>
            );
          })}
          {graph.nodes.map((n) => {
            const p = positions.get(n.key);
            if (!p) return null;
            const root = n.key === graph.root;
            const r = (root ? NODE_R + 3 : NODE_R) * k;
            // labels sit under their node, centred, on a background — the picture stays inside its box
            const label = (
              <>
                <circle
                  r={r}
                  className={cn(NODE_FILL[n.type], root && "stroke-foreground")}
                  strokeWidth={root ? 2 * k : 0}
                />
                <text
                  y={r + 12 * k}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={cn("fill-foreground stroke-background", root && "font-medium")}
                  strokeWidth={4 * k}
                  paintOrder="stroke"
                >
                  {shortLabel(n.label)}
                </text>
                {amountOf(n) && (
                  <text
                    y={r + 26 * k}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-muted-foreground stroke-background tabular-nums"
                    strokeWidth={4 * k}
                    paintOrder="stroke"
                  >
                    {amountOf(n)}
                  </text>
                )}
                <title>{`${t(`linking.type.${n.type}`)} · ${n.label}`}</title>
              </>
            );
            return (
              <g key={n.key} transform={`translate(${p.x} ${p.y})`}>
                {root ? (
                  label
                ) : (
                  <a
                    href={graphHref(n)}
                    tabIndex={-1}
                    className="cursor-pointer"
                    onClick={(ev) => {
                      ev.preventDefault();
                      router.push(graphHref(n));
                    }}
                  >
                    {label}
                  </a>
                )}
              </g>
            );
          })}
        </svg>
      </figure>

      <section aria-label={t("linking.graph.list")} className="min-w-0">
        {graph.truncated && (
          <p className="mb-2 text-xs text-muted-foreground" data-testid="graph-truncated">
            {t("linking.graph.truncated")}
          </p>
        )}
        {graph.nodes.length === 1 && (
          <p className="text-sm text-muted-foreground">{t("linking.noLinks")}</p>
        )}
        {rings.map(([depth, nodes]) =>
          depth === 0 ? null : (
            <Fragment key={depth}>
              <h2 className="mt-3 mb-1 text-xs font-medium text-muted-foreground first:mt-0">
                {t(depth === 1 ? "linking.graph.ringOne" : "linking.graph.ringMany", {
                  depth,
                  count: nodes.length,
                })}
              </h2>
              <ul className="divide-y rounded-md border text-sm">
                {nodes.map((n) => (
                  <li
                    key={n.key}
                    className="flex items-center justify-between gap-2 px-3 py-1.5"
                    data-testid="graph-node"
                  >
                    <span className="min-w-0 truncate">
                      <Badge variant="outline" className="mr-2">
                        {t(`linking.type.${n.type}`)}
                      </Badge>
                      <span title={n.label}>{n.label}</span>
                      {amountOf(n) && (
                        <span className="ml-2 text-muted-foreground tabular-nums">
                          {amountOf(n)}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-xs">
                      <Link href={graphHref(n)} className="hover:underline">
                        {t("linking.graph.open")}
                      </Link>
                      <Link
                        href={entityHref(n)}
                        className="hover:underline"
                        data-testid="graph-open"
                      >
                        {t("linking.graph.openEntity")}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </Fragment>
          ),
        )}
      </section>
    </div>
  );
}
