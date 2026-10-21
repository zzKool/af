import { describe, expect, it } from "vitest";
import { layoutGraph, MARGIN, RING, shortLabel } from "./graph-layout";
import type { Graph, GraphNode } from "./types";

const node = (key: string, depth: number, parent: string | null): GraphNode => ({
  key,
  type: "document",
  id: key,
  label: key,
  amount: null,
  currency: null,
  depth,
  parent,
});

describe("layoutGraph", () => {
  it("puts the root in the centre and each hop on its own ring", () => {
    const graph: Graph = {
      root: "r",
      nodes: [node("r", 0, null), node("a", 1, "r"), node("b", 1, "r"), node("a1", 2, "a")],
      edges: [],
      truncated: false,
    };
    const { positions, extent } = layoutGraph(graph);
    expect(positions.get("r")).toEqual({ x: 0, y: 0 });
    const radius = (k: string) => Math.hypot(positions.get(k)?.x ?? 0, positions.get(k)?.y ?? 0);
    expect(radius("a")).toBeCloseTo(RING, 6);
    expect(radius("b")).toBeCloseTo(RING, 6);
    expect(radius("a1")).toBeCloseTo(2 * RING, 6);
    expect(extent).toBe(2 * RING + MARGIN);
  });

  it("gives siblings distinct angles and keeps a child inside its parent's sector", () => {
    const graph: Graph = {
      root: "r",
      nodes: [
        node("r", 0, null),
        node("a", 1, "r"),
        node("b", 1, "r"),
        node("c", 1, "r"),
        node("a1", 2, "a"),
        node("a2", 2, "a"),
      ],
      edges: [],
      truncated: false,
    };
    const { positions } = layoutGraph(graph);
    const angle = (k: string) => Math.atan2(positions.get(k)?.y ?? 0, positions.get(k)?.x ?? 0);
    const angles = ["a", "b", "c"].map(angle);
    expect(new Set(angles.map((a) => a.toFixed(6))).size).toBe(3);
    // a has two leaves under it, b and c one each: a's sector is half the circle, its children sit around it
    const [a1, a2] = [angle("a1"), angle("a2")];
    expect(Math.abs(a1 - angle("a"))).toBeLessThan(Math.PI / 2);
    expect(Math.abs(a2 - angle("a"))).toBeLessThan(Math.PI / 2);
    expect(a1).not.toBeCloseTo(a2, 6);
  });

  it("a lone root has the margin as its extent", () => {
    const graph: Graph = { root: "r", nodes: [node("r", 0, null)], edges: [], truncated: false };
    expect(layoutGraph(graph).extent).toBe(MARGIN);
  });
});

describe("shortLabel", () => {
  it("keeps short labels and truncates long ones with an ellipsis", () => {
    expect(shortLabel("ACME26-INV-001")).toBe("ACME26-INV-001");
    expect(shortLabel("x".repeat(40), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
