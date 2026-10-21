// Radial layout of a neighbourhood — pure. The root sits in the centre, each hop is one ring; a node's angular
// sector grows with the leaves under it (square root), so a crowded branch gets room and siblings never overlap.
import type { Graph, GraphNode } from "./types";

export const RING = 150;
export const MARGIN = 140;

export type Point = { x: number; y: number };

export type Layout = {
  /** node key → position (the root at 0,0) */
  positions: Map<string, Point>;
  /** half the side of the square the picture needs */
  extent: number;
};

export function layoutGraph(graph: Graph): Layout {
  const children = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.parent === null) continue;
    children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  }
  const leaves = new Map<string, number>();
  const countLeaves = (key: string): number => {
    const kids = children.get(key) ?? [];
    const n = kids.length === 0 ? 1 : kids.reduce((s, k) => s + countLeaves(k.key), 0);
    leaves.set(key, n);
    return n;
  };
  countLeaves(graph.root);

  // a branch's share of its parent's sector grows with its leaves, but sub-linearly, so leaves next to a
  // bushy sibling still get room for their label
  const weight = (key: string) => Math.sqrt(leaves.get(key) ?? 1);
  const positions = new Map<string, Point>([[graph.root, { x: 0, y: 0 }]]);
  const place = (key: string, depth: number, start: number, end: number) => {
    const kids = children.get(key) ?? [];
    const total = kids.reduce((s, k) => s + weight(k.key), 0) || 1;
    let a = start;
    for (const kid of kids) {
      const span = ((end - start) * weight(kid.key)) / total;
      const mid = a + span / 2;
      const r = RING * (depth + 1);
      positions.set(kid.key, { x: r * Math.cos(mid), y: r * Math.sin(mid) });
      place(kid.key, depth + 1, a, a + span);
      a += span;
    }
  };
  // start at "north" so the first branch reads top-down
  place(graph.root, 0, -Math.PI / 2, (3 * Math.PI) / 2);

  const maxDepth = graph.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  return { positions, extent: RING * maxDepth + MARGIN };
}

/** The label shortened for the picture; the full one goes in the title. */
export function shortLabel(label: string, max = 34): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
