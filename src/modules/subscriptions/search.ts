// Global search (F93, D56): subscriptions — by name or match text, the vendor's name, or an expected amount (any
// price). One query for the subscriptions, one batched read of the vendors' names for the ≤ 50 candidates.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import {
  emptyGroup,
  isoDate,
  parseSearchQuery,
  rankOf,
  seeAllHref,
  toGroup,
} from "@/kernel/search/query";
import { CANDIDATE_LIMIT, type SearchGroup, type SearchHit } from "@/kernel/search/types";
import * as partners from "@/modules/partners";

export async function searchSubscriptionHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/subscriptions", raw);
  if (!q || !can(caller, "read", "subscription")) return { data: emptyGroup("subscription", all) };

  const contains = { contains: q.text, mode: "insensitive" as const };
  const vendors = await partners.getPartners(tx, { types: ["vendor"], search: q.text });
  const vendorIds = (vendors.data ?? []).map((p) => p.id);
  const rows = await tx.subscription.findMany({
    where: {
      OR: [
        { name: contains },
        { matchText: contains },
        ...(vendorIds.length ? [{ partnerId: { in: vendorIds } }] : []),
        ...(q.amount ? [{ prices: { some: { amount: q.amount } } }] : []),
      ],
    },
    include: { prices: { orderBy: { validFrom: "desc" }, take: 1 } },
    orderBy: [{ startDate: "desc" }],
    take: CANDIDATE_LIMIT,
  });
  const names = await partners.partnerNames(tx, [...new Set(rows.map((r) => r.partnerId))]);

  const hits: SearchHit[] = rows.flatMap((r) => {
    const price = r.prices[0];
    const amount = price?.amount.toFixed(2);
    const vendor = names.get(r.partnerId) ?? null;
    const rank = rankOf(q, {
      keys: [],
      names: [r.name, vendor],
      texts: [r.matchText],
      amounts: [amount],
    });
    return rank === null
      ? []
      : [
          {
            kind: "subscription" as const,
            id: r.id,
            key: null,
            label: vendor && vendor !== r.name ? `${r.name} · ${vendor}` : r.name,
            date: isoDate(r.startDate),
            ...(price ? { amount, currency: price.currency } : {}),
            href: `/subscriptions?open=${r.id}`,
            rank,
          },
        ];
  });
  return { data: toGroup("subscription", hits, all) };
}
