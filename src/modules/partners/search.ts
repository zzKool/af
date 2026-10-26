// Global search (F93, D56): the partners the palette finds — by name, short code, org / VAT number.
// One query, newest-first candidates ranked by the kernel rules; inactive partners are found too (they keep their
// documents and invoices).
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { emptyGroup, parseSearchQuery, rankOf, seeAllHref, toGroup } from "@/kernel/search/query";
import { CANDIDATE_LIMIT, type SearchGroup, type SearchHit } from "@/kernel/search/types";

export async function searchPartnerHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/partners", raw);
  if (!q || !can(caller, "read", "partner")) return { data: emptyGroup("partner", all) };

  const contains = { contains: q.text, mode: "insensitive" as const };
  const rows = await tx.partner.findMany({
    where: {
      OR: [
        { name: contains },
        { shortCode: contains },
        { orgNumber: contains },
        { vatNumber: contains },
      ],
    },
    select: { id: true, name: true, shortCode: true, orgNumber: true, vatNumber: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: CANDIDATE_LIMIT,
  });

  const hits: SearchHit[] = rows.flatMap((p) => {
    const rank = rankOf(q, {
      keys: [p.shortCode, p.orgNumber, p.vatNumber],
      names: [p.name],
    });
    return rank === null
      ? []
      : [
          {
            kind: "partner" as const,
            id: p.id,
            key: p.shortCode,
            label: p.name,
            date: null,
            href: `/partners/${p.id}`,
            rank,
          },
        ];
  });
  return { data: toGroup("partner", hits, all) };
}
