// The sidebar's count on Banking (F72): the main accounts' rows still to justify (open | partial) — the number
// the dashboard's *rows to justify* and the banking inbox show, without the workbench's list. Two queries: the
// rows that could still be open (id, amount; the *no document needed* flag is on the row, F113, so the database
// drops those), then the links touching them (Σ allocated, transfer legs) through linking's index. The state is
// `deriveTransactionState`.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as linking from "@/modules/linking";
import { linkFactsOf } from "./months";
import { deriveTransactionState, listMainAccountIds } from "./queries";

export async function rowsToJustifyCount(tx: TransactionClient): Promise<number> {
  const mainIds = await listMainAccountIds(tx);
  if (mainIds.length === 0) return 0;
  const rows = await tx.bankTransaction.findMany({
    where: { bankAccountId: { in: mainIds }, noDocumentNeeded: false },
    select: { id: true, amount: true },
  });
  if (rows.length === 0) return 0;
  const facts = linkFactsOf(
    await linking.linksTouching(
      tx,
      "bank_transaction",
      rows.map((r) => r.id),
    ),
  );
  return rows.filter((r) => {
    const state = deriveTransactionState({
      amount: r.amount.toFixed(2),
      allocated: facts.allocated.get(r.id) ?? "0.00",
      inTransfer: facts.transfer.has(r.id),
      noDocumentNeeded: false,
    });
    return state === "open" || state === "partial";
  }).length;
}
