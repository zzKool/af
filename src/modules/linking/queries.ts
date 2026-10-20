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
