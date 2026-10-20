// Read API of the linking module.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { getLinkable } from "./linkable";
import { getLinksFor } from "./linking";
import type { LinkDto, LinkEndpoint } from "./types";

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
