// The links state of a ledger row (T004, US4): derived from links on every read, never typed. A bank entry reads
// its transaction's links — the same facts as the banking workbench's state; a manual entry reads its own.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { isSettled } from "@/kernel/money/settlement";
import type { JournalEntryDto, LinksState } from "./types";

const D = Prisma.Decimal;

/**
 * `no_document` when the flag is set or the row is a transfer leg (the other statement row is its proof, D44);
 * `justified` when Σ allocations covers |amount| within the settlement tolerance; `partly` when Σ > 0; else `none`.
 */
export function deriveLinksState(input: {
  amount: string;
  allocated: string;
  inTransfer: boolean;
  noDocumentNeeded: boolean;
}): LinksState {
  if (input.noDocumentNeeded || input.inTransfer) return "no_document";
  const allocated = new D(input.allocated);
  if (allocated.lte(0)) return "none";
  return isSettled(new D(input.amount).abs(), [allocated]) ? "justified" : "partly";
}

/** Σ allocated and the links state of each entry — three grouped queries through linking's read API. */
export async function linksStates(
  tx: TransactionClient,
  entries: readonly JournalEntryDto[],
): Promise<Map<string, { allocated: string; state: LinksState }>> {
  // loaded on first use, like implicit-rate.ts: a top-level import closes a load cycle through banking
  const linking = await import("@/modules/linking");
  const bankIds = entries.flatMap((e) =>
    e.sourceType === "bank_transaction" && e.sourceId ? [e.sourceId] : [],
  );
  const manualIds = entries.flatMap((e) => (e.sourceType === "manual" ? [e.id] : []));
  const fromBank = await linking.allocatedFrom(tx, "bank_transaction", bankIds);
  const fromManual = await linking.allocatedFrom(tx, "journal_entry", manualIds);
  const transfers = await linking.linksTouching(tx, "bank_transaction", bankIds, {
    kinds: ["transfer"],
  });
  const inTransfer = new Set(transfers.flatMap((l) => [l.from.id, l.to.id]));
  const out = new Map<string, { allocated: string; state: LinksState }>();
  for (const e of entries) {
    const bank = e.sourceType === "bank_transaction";
    const allocated = (bank ? fromBank.get(e.sourceId ?? "") : fromManual.get(e.id)) ?? "0.00";
    const state = deriveLinksState({
      amount: e.amount,
      allocated,
      inTransfer: bank && inTransfer.has(e.sourceId ?? ""),
      noDocumentNeeded: e.noDocumentNeeded,
    });
    out.set(e.id, { allocated, state });
  }
  return out;
}
