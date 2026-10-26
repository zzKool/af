// Global search (F93, D56): documents — by business key (`exp_20230412_001`, `SI213-Acc-01_2023-04-12_…`) and file
// name. Relationship documents (contracts, NDAs) only for a role that may read them (not the accountant). One query.
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

export async function searchDocumentHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/documents", raw);
  const financial = can(caller, "read", "financial_document");
  const relationship = can(caller, "read", "relationship_document");
  if (!q || (!financial && !relationship)) return { data: emptyGroup("document", all) };

  const contains = { contains: q.text, mode: "insensitive" as const };
  const rows = await tx.document.findMany({
    where: {
      OR: [{ businessKey: contains }, { fileName: contains }],
      // the role's documents only: `financial` is the accountant's, anything else is a relationship document
      ...(financial && relationship
        ? {}
        : financial
          ? { documentType: "financial" }
          : { documentType: { not: "financial" } }),
    },
    select: { id: true, businessKey: true, fileName: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }],
    take: CANDIDATE_LIMIT,
  });

  const hits: SearchHit[] = rows.flatMap((r) => {
    const rank = rankOf(q, { keys: [r.businessKey], texts: [r.fileName] });
    return rank === null
      ? []
      : [
          {
            kind: "document" as const,
            id: r.id,
            key: r.businessKey,
            label: r.fileName,
            date: isoDate(r.createdAt),
            href: `/documents/${r.id}`,
            rank,
          },
        ];
  });
  return { data: toGroup("document", hits, all) };
}
