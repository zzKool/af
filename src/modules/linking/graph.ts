// The graph read model (constitution §1.2, D18): everything connected to one entity, breadth-first over the
// `links` table up to `depth` hops, each node labelled by its module's linkable. A disposable view — nothing is
// stored. Capped so a busy partner never returns the whole company.
import { mapInOrder, type TransactionClient } from "@/kernel/db/tenant-client";
import { getLinkable } from "./linkable";
import { linksTouching } from "./queries";
import type { Graph, GraphEdge, GraphNode, LinkableType, LinkDto, LinkEndpoint } from "./types";

export const GRAPH_MAX_DEPTH = 3;
export const GRAPH_DEFAULT_DEPTH = 2;
export const GRAPH_MAX_NODES = 80;

export type GraphOptions = {
  /** hops to walk (clamped to 0 … GRAPH_MAX_DEPTH) */
  depth?: number;
  /** nodes to keep, root included (tests lower it) */
  maxNodes?: number;
};

export const nodeKey = (e: LinkEndpoint): string => `${e.type}:${e.id}`;

function groupByType(endpoints: readonly LinkEndpoint[]): Map<LinkableType, string[]> {
  const byType = new Map<LinkableType, string[]>();
  for (const e of endpoints) byType.set(e.type, [...(byType.get(e.type) ?? []), e.id]);
  return byType;
}

async function linksOf(
  tx: TransactionClient,
  frontier: readonly LinkEndpoint[],
): Promise<LinkDto[]> {
  const found: LinkDto[] = [];
  for (const [type, ids] of groupByType(frontier))
    found.push(...(await linksTouching(tx, type, ids)));
  return found;
}

/** The neighbourhood of `root`, or null when the root does not exist in the caller's tenant. */
export async function neighbourhood(
  tx: TransactionClient,
  root: LinkEndpoint,
  options: GraphOptions = {},
): Promise<Graph | null> {
  const linkable = getLinkable(root.type);
  if (!linkable || !(await linkable.exists(tx, root.id))) return null;
  const maxDepth = Math.max(0, Math.min(GRAPH_MAX_DEPTH, options.depth ?? GRAPH_DEFAULT_DEPTH));
  const maxNodes = Math.max(1, options.maxNodes ?? GRAPH_MAX_NODES);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge & { createdAt: Date }>();
  const rootKey = nodeKey(root);
  nodes.set(rootKey, blank(rootKey, root, 0, null));
  let frontier: LinkEndpoint[] = [root];
  let truncated = false;

  for (let d = 1; d <= maxDepth && frontier.length > 0; d += 1) {
    const frontierKeys = new Set(frontier.map(nodeKey));
    const next: LinkEndpoint[] = [];
    for (const l of await linksOf(tx, frontier)) {
      if (edges.has(l.id)) continue;
      edges.set(l.id, {
        id: l.id,
        from: nodeKey(l.from),
        to: nodeKey(l.to),
        kind: l.kind,
        allocatedAmount: l.allocatedAmount,
        currency: l.currency,
        createdAt: l.createdAt,
      });
      // the end on the frontier is the parent; a link between two frontier nodes adds no node
      const fromKey = nodeKey(l.from);
      const toKey = nodeKey(l.to);
      const [parentKey, child] = frontierKeys.has(fromKey) ? [fromKey, l.to] : [toKey, l.from];
      const childKey = nodeKey(child);
      if (nodes.has(childKey)) continue;
      if (nodes.size >= maxNodes) {
        truncated = true;
        continue;
      }
      nodes.set(childKey, blank(childKey, child, d, parentKey));
      next.push(child);
    }
    frontier = next;
  }
  // the last ring may have links of its own that the depth did not let us walk
  if (!truncated && frontier.length > 0) {
    truncated = (await linksOf(tx, frontier)).some((l) => !edges.has(l.id));
  }

  // labels through the linkables, one node at a time (≤ maxNodes; one tx runs one query at a time, F53)
  await mapInOrder([...nodes.values()], async (n) => {
    const s = await getLinkable(n.type)?.summary(tx, n.id);
    n.label = s?.label ?? `${n.type} ${n.id.slice(0, 8)}`;
    n.amount = s?.amount ?? null;
    n.currency = s?.currency ?? null;
  });
  // an edge whose far end the cap cut is not drawn — the picture only shows what it names
  const kept = [...edges.values()]
    .filter((e) => nodes.has(e.from) && nodes.has(e.to))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map(({ createdAt: _, ...e }) => e);
  return { root: rootKey, nodes: [...nodes.values()], edges: kept, truncated };
}

function blank(key: string, e: LinkEndpoint, depth: number, parent: string | null): GraphNode {
  return { key, type: e.type, id: e.id, label: "", amount: null, currency: null, depth, parent };
}
