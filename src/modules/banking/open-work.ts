// The sidebar's count on Banking (F72): the main accounts' rows still to justify (open | partial) — the number
// the dashboard's *rows to justify* and the banking inbox show, without the workbench's list. Read in three
// narrowing steps, each only over what is left: the rows (id, amount), the links touching them (Σ allocated,
// transfer legs), then the journal's flag of the rows still open. The state is `deriveTransactionState`.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as journal from "@/modules/journal";
import * as linking from "@/modules/linking";
import { linkFactsOf } from "./months";
import { deriveTransactionState, listMainAccountIds } from "./queries";

export async function rowsToJustifyCount(tx: TransactionClient): Promise<number> {
  const mainIds = await listMainAccountIds(tx);
  if (mainIds.length === 0) return 0;
  const rows = await tx.bankTransaction.findMany({
    where: { bankAccountId: { in: mainIds } },
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
  // the state without the journal's flag: a linked row or a transfer leg is done whatever the flag says
  const candidates = rows.filter((r) => {
    const state = deriveTransactionState({
      amount: r.amount.toFixed(2),
      allocated: facts.allocated.get(r.id) ?? "0.00",
      inTransfer: facts.transfer.has(r.id),
      noDocumentNeeded: false,
    });
    return state === "open" || state === "partial";
  });
  if (candidates.length === 0) return 0;
  const entries = await journal.entriesForSources(
    tx,
    "bank_transaction",
    candidates.map((r) => r.id),
  );
  return candidates.filter((r) => !entries.get(r.id)?.noDocumentNeeded).length;
}
