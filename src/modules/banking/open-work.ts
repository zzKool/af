// The sidebar's count on Banking (F72): the main accounts' rows still to justify — open, partially linked, or
// justified without a partner (F129, D73) — the number the dashboard's *rows to justify* and the banking inbox show,
// without the workbench's list. The database drops what is justified for sure (flagged with a typed partner); the
// shared read `rowFacts` (Σ allocated, the transfer legs, the effective partner) and `deriveTransactionState` decide
// the rest — the same rule as the list and the Months panel.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { needsProof } from "./months";
import { deriveTransactionState, listMainAccountIds, rowFacts } from "./queries";

export async function rowsToJustifyCount(tx: TransactionClient): Promise<number> {
  const mainIds = await listMainAccountIds(tx);
  if (mainIds.length === 0) return 0;
  const rows = await tx.bankTransaction.findMany({
    where: {
      bankAccountId: { in: mainIds },
      OR: [{ noDocumentNeeded: false }, { partnerId: null }],
    },
    select: {
      id: true,
      amount: true,
      currency: true,
      amountBase: true,
      noDocumentNeeded: true,
      partnerId: true,
      basCode: true,
    },
  });
  if (rows.length === 0) return 0;
  const facts = await rowFacts(tx, rows);
  return rows.filter((r) =>
    needsProof(
      deriveTransactionState({
        amount: r.amount.toFixed(2),
        allocated: facts.allocated.get(r.id) ?? "0.00",
        inTransfer: facts.transfer.has(r.id),
        noDocumentNeeded: r.noDocumentNeeded,
        partnerId: facts.effective.get(r.id)?.partnerId ?? null,
        accountRole: "main",
      }),
    ),
  ).length;
}
