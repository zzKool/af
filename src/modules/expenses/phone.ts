// The phone page's after-save summary (F142, Pulse phase 6c; the board *Phone*): what the company owes the owner
// in total (the open private expenses, in the base) and the receipts still missing (the newest expenses with no
// document). Read only — the same reads the dashboard and the expenses list make.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { ledgerSnapshot, listExpenses } from "./queries";

/** How many missing receipts the phone lists. */
export const PHONE_MISSING = 5;

export type PhoneSummary = {
  /** what the company owes the owner, in the base (open private expenses) */
  owed: string;
  owedCount: number;
  /** the newest expenses still without a receipt */
  missing: {
    id: string;
    key: string;
    date: string;
    description: string;
    amount: string;
    currency: string;
  }[];
};

export async function phoneSummary(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<PhoneSummary> {
  const ledger = await ledgerSnapshot(tx);
  const list = await listExpenses(tx, {
    page: 1,
    pageSize: PHONE_MISSING,
    sort: [{ col: "date", dir: "desc" }],
    filters: { hasDocument: { kind: "in", values: ["false"] } },
  });
  return {
    owed: ledger.total.openBase,
    owedCount: ledger.total.openCount,
    missing: list.rows.map((r) => ({
      id: r.id,
      key: r.key,
      date: String(r.date),
      description: r.description,
      amount: r.amount,
      currency: r.currency,
    })),
  };
}
