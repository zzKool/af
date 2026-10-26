"use client";

// The neighbourhood of one entity (specs/linking, graph read model): a radial picture — the root in the centre,
// one ring per hop, edges labelled by kind — and, beside it, the same nodes as a list with *Graph* (re-root)
// and *Open* (the entity's own page). The list is the accessible form; the picture is decoration for the eye.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { RowActionsMenu } from "@/kernel/ui/data-table";
import { Tag } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import { layoutGraph, shortLabel } from "@/modules/linking/graph-layout";
import { entityHref, graphHref } from "@/modules/linking/hrefs";
import type { Graph, GraphNode, LinkableType } from "@/modules/linking/types";
import { EntityLabel } from "./entity-label";
import { moneyText } from "./money";

// One token per place in the monthly loop (the sidebar's groups), never a palette colour (D40): the money
// movements, sales, costs, the proof, the parties. The type itself is in the tooltip and on the list's tag.
const NODE_FILL: Record<LinkableType, string> = {
  bank_transaction: "fill-chart-1",
  journal_entry: "fill-chart-1",
  invoice: "fill-chart-2",
  supplier_invoice: "fill-chart-3",
  expense: "fill-chart-3",
  settlement: "fill-chart-3",
  subscription: "fill-chart-3",
  document: "fill-chart-4",
  partner: "fill-chart-5",
  contract: "fill-chart-5",
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
  const amountOf = (n: GraphNode) => moneyText(n.amount, n.currency);
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
            const label = [t(`linking.kind.${e.kind}`), moneyText(e.allocatedAmount, e.currency)]
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
              <ul className="divide-y divide-subtle rounded-md border text-[13px]">
                {nodes.map((n) => (
                  <li
                    key={n.key}
                    className="flex h-8 items-center gap-2 px-3"
                    data-testid="graph-node"
                  >
                    <Tag className="shrink-0">{t(`linking.type.${n.type}`)}</Tag>
                    <Link
                      href={entityHref(n)}
                      className="flex min-w-0 flex-1 items-center hover:underline"
                      data-testid="graph-open"
                    >
                      <EntityLabel type={n.type} label={n.label} />
                    </Link>
                    {amountOf(n) && (
                      <span
                        className="shrink-0 text-muted-foreground tabular-nums"
                        data-amount={n.amount ?? undefined}
                      >
                        {amountOf(n)}
                      </span>
                    )}
                    <RowActionsMenu
                      label={t("table.rowActions")}
                      actions={[
                        {
                          label: t("linking.graph.open"),
                          onClick: () => router.push(graphHref(n)),
                        },
                        {
                          label: t("linking.graph.openEntity"),
                          onClick: () => router.push(entityHref(n)),
                        },
                      ]}
                    />
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
