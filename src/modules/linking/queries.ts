// Read API of the linking module.
import { mapInOrder, type TransactionClient } from "@/kernel/db/tenant-client";
import { ALLOCATING_KINDS } from "./kinds";
import { getLinkable } from "./linkable";
import { getLinksFor, toLinkDto } from "./linking";
import type { LinkableType, LinkDto, LinkEndpoint, LinkKind } from "./types";

export { getAllocationStatus, getLinksFor, isLinked } from "./linking";

/** The entity's links with the other side's label (through its linkable's summary) — what every panel lists. */
export async function linksWithLabels(
  tx: TransactionClient,
  self: LinkEndpoint,
): Promise<(LinkDto & { otherLabel: string | null })[]> {
  const links = (await getLinksFor(tx, self)).data ?? [];
  return mapInOrder(links, async (l) => {
    const other = l.from.type === self.type && l.from.id === self.id ? l.to : l.from;
    const summary = await getLinkable(other.type)?.summary(tx, other.id);
    return { ...l, otherLabel: summary?.label ?? null };
  });
}

/**
 * True when `endpoint` takes part in at least one link of `kind`, on either side — the existence check a module's
 * guard asks (no `justifies` yet on an open expense / supplier invoice, no `created_from` on a document yet) instead of
 * counting `tx.link` itself (lessons audit 22). Any kind at all: `isLinked`.
 */
export async function hasLinks(
  tx: TransactionClient,
  endpoint: LinkEndpoint,
  kind: LinkKind,
): Promise<boolean> {
  const hit = await tx.link.findFirst({
    where: {
      kind,
      OR: [
        { fromType: endpoint.type, fromId: endpoint.id },
        { toType: endpoint.type, toId: endpoint.id },
      ],
    },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * Every link touching any of `ids` of one type, in one query — the package's *Links* sheet and the document set of a
 * period (specs/accountant-package/spec.md FR-002). Ordered by creation, the deterministic order of its R6.
 * `kinds` narrows it (banking reads only the `transfer` links of its rows for the implied rate, D44).
 */
export async function linksTouching(
  tx: TransactionClient,
  type: LinkableType,
  ids: readonly string[],
  options: { kinds?: readonly LinkKind[] } = {},
): Promise<LinkDto[]> {
  if (ids.length === 0) return [];
  const rows = await tx.link.findMany({
    where: {
      ...(options.kinds ? { kind: { in: [...options.kinds] } } : {}),
      OR: [
        { fromType: type, fromId: { in: [...ids] } },
        { toType: type, toId: { in: [...ids] } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toLinkDto);
}

/**
 * Σ of the allocations FROM each of `ids` (allocating kinds only — `justifies`, `settles`), in one grouped query;
 * ids with no allocation are absent. What "how much of this movement is proven" reads (audit 22).
 */
export async function allocatedFrom(
  tx: TransactionClient,
  type: LinkableType,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const sums = await tx.link.groupBy({
    by: ["fromId"],
    where: {
      fromType: type,
      fromId: { in: [...ids] },
      kind: { in: [...ALLOCATING_KINDS] },
      allocatedAmount: { not: null },
    },
    _sum: { allocatedAmount: true },
  });
  for (const s of sums)
    if (s._sum.allocatedAmount) out.set(s.fromId, s._sum.allocatedAmount.toFixed(2));
  return out;
}

/**
 * Σ of the allocations ONTO each of `ids` (allocating kinds only — `justifies`, `settles`), whatever the source —
 * a bank row — in one grouped query; ids with no allocation are absent. In the target's currency
 * (an allocation is written in it). What "how much of this invoice / expense / settlement is paid" reads — the
 * mirror of `allocatedFrom` and the rule `getAllocationStatus` applies to one entity (audit 22).
 */
export async function allocatedSums(
  tx: TransactionClient,
  type: LinkableType,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const sums = await tx.link.groupBy({
    by: ["toId"],
    where: {
      toType: type,
      toId: { in: [...ids] },
      kind: { in: [...ALLOCATING_KINDS] },
      allocatedAmount: { not: null },
    },
    _sum: { allocatedAmount: true },
  });
  for (const s of sums)
    if (s._sum.allocatedAmount) out.set(s.toId, s._sum.allocatedAmount.toFixed(2));
  return out;
}

/** What a document became: the entity on the other end of its `created_from` link. */
export type CreatedFromTarget = LinkEndpoint & {
  /** the entity's label through its linkable's summary; null unless asked for, or when it is gone */
  label: string | null;
  /** the entity's key — the label's head: the `created_from` sources (expense, supplier invoice) label as `{key} · …` */
  key: string | null;
};

/**
 * For each of `documentIds`, the entity created from it (`created_from`, D27 — one origin per document), in one
 * query; documents nothing was created from are absent. `labels: true` resolves each target's label through its
 * linkable (one summary per target): ask for it on a page of rows, not on a whole read model.
 */
export async function createdFromTargets(
  tx: TransactionClient,
  documentIds: readonly string[],
  options: { labels?: boolean } = {},
): Promise<Map<string, CreatedFromTarget>> {
  const out = new Map<string, CreatedFromTarget>();
  if (documentIds.length === 0) return out;
  const rows = await tx.link.findMany({
    where: { kind: "created_from", toType: "document", toId: { in: [...documentIds] } },
    select: { fromType: true, fromId: true, toId: true },
  });
  for (const r of rows) {
    const type = r.fromType as LinkableType;
    const label = options.labels
      ? ((await getLinkable(type)?.summary(tx, r.fromId))?.label ?? null)
      : null;
    out.set(r.toId, { type, id: r.fromId, label, key: label?.split(" · ")[0] ?? null });
  }
  return out;
}
