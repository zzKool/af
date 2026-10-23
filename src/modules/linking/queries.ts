// Read API of the linking module.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { getLinkable } from "./linkable";
import { getLinksFor, toLinkDto } from "./linking";
import type { LinkableType, LinkDto, LinkEndpoint } from "./types";

export { getAllocationStatus, getLinksFor, isLinked } from "./linking";

/** The entity's links with the other side's label (through its linkable's summary) — what every panel lists. */
export async function linksWithLabels(
  tx: TransactionClient,
  self: LinkEndpoint,
): Promise<(LinkDto & { otherLabel: string | null })[]> {
  const links = (await getLinksFor(tx, self)).data ?? [];
  return Promise.all(
    links.map(async (l) => {
      const other = l.from.type === self.type && l.from.id === self.id ? l.to : l.from;
      const summary = await getLinkable(other.type)?.summary(tx, other.id);
      return { ...l, otherLabel: summary?.label ?? null };
    }),
  );
}

/**
 * Every link touching any of `ids` of one type, in one query — the package's *Links* sheet and the document set of a
 * period (specs/accountant-package/spec.md FR-002). Ordered by creation, the deterministic order of its R6.
 */
export async function linksTouching(
  tx: TransactionClient,
  type: LinkableType,
  ids: readonly string[],
): Promise<LinkDto[]> {
  if (ids.length === 0) return [];
  const rows = await tx.link.findMany({
    where: {
      OR: [
        { fromType: type, fromId: { in: [...ids] } },
        { toType: type, toId: { in: [...ids] } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toLinkDto);
}

/** What a document became: the entity on the other end of its `created_from` link. */
export type CreatedFromTarget = LinkEndpoint & {
  /** the entity's label (its key) through its linkable's summary; null unless asked for, or when it is gone */
  label: string | null;
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
    out.set(r.toId, { type, id: r.fromId, label });
  }
  return out;
}
