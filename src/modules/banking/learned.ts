// The rows the learning reads (T028, D82): the ones the owner categorised by hand and the ones a proof justifies —
// each with what it teaches (`learnedFacts`: a value typed by hand or given by the proof, never a rule's guess). The
// Justify click types nothing on the row since D82, so the proof's partner and category are read here, derived, as
// every page reads them (`rowFacts`). Read only. MUST NOT import from next/* or src/components/*.
import type { BankTransaction, Prisma } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as linking from "@/modules/linking";
import { learnedFacts } from "./effective";
import { rowFacts } from "./queries";

export type LearnedRow = BankTransaction & {
  /** what the row teaches; a null fact teaches nothing */
  learned: { partnerId: string | null; basCode: string | null };
};

/**
 * The rows matching `where` that teach something — by hand (`categorised_by = manual`) or with a proof — newest
 * first, `take` at most, each with its learned facts. A row with neither (a rule's, or untouched) is left out.
 */
export async function learnedRows(
  tx: TransactionClient,
  where: Prisma.BankTransactionWhereInput,
  options: { take?: number } = {},
): Promise<LearnedRow[]> {
  const proven = await linking.rowsWithProof(tx);
  const rows = await tx.bankTransaction.findMany({
    where: {
      AND: [
        where,
        {
          OR: [
            { categorisedBy: "manual" },
            ...(proven.size > 0 ? [{ id: { in: [...proven] } }] : []),
          ],
        },
      ],
    },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    ...(options.take !== undefined ? { take: options.take } : {}),
  });
  if (rows.length === 0) return [];
  const facts = await rowFacts(tx, rows);
  return rows.map((r) => {
    const e = facts.effective.get(r.id);
    return {
      ...r,
      learned: e
        ? learnedFacts(r.categorisedBy, e)
        : learnedFacts(r.categorisedBy, {
            partnerId: r.partnerId,
            partnerFrom: r.partnerId ? "row" : null,
            basCode: r.basCode,
            basFrom: r.basCode ? "row" : null,
          }),
    };
  });
}
