// F187: which BAS accounts the tenant's records already carry — the accounts *Use my usual accounts* never
// deactivates. A count read only (the lead's choice over one hook per module, 2026-11-10): settings reads the
// `bas_code` column of each owning module's table, never writes there, and names the tenant in every where (the seed
// runs as the migration role, without RLS). A module that adds a BAS column adds it here.
import type { TransactionClient } from "@/kernel/db/tenant-client";

/** account → how many records carry it: expenses, supplier invoices and lines, bank rows, rules, subscriptions, journal entries, partners' defaults. */
export async function basCodesInUse(
  tx: TransactionClient,
  tenantId: string,
): Promise<Map<string, number>> {
  const where = { tenantId };
  const counts = new Map<string, number>();
  const add = (rows: { code: string | null; n: number }[]) => {
    for (const r of rows) if (r.code) counts.set(r.code, (counts.get(r.code) ?? 0) + r.n);
  };
  const by = <T extends { basCode: string | null; _count: { _all: number } }>(rows: T[]) =>
    rows.map((r) => ({ code: r.basCode, n: r._count._all }));

  add(by(await tx.expense.groupBy({ by: ["basCode"], where, _count: { _all: true } })));
  add(by(await tx.supplierInvoice.groupBy({ by: ["basCode"], where, _count: { _all: true } })));
  add(by(await tx.supplierInvoiceLine.groupBy({ by: ["basCode"], where, _count: { _all: true } })));
  add(by(await tx.bankTransaction.groupBy({ by: ["basCode"], where, _count: { _all: true } })));
  add(by(await tx.categorisationRule.groupBy({ by: ["basCode"], where, _count: { _all: true } })));
  add(by(await tx.subscription.groupBy({ by: ["basCode"], where, _count: { _all: true } })));
  add(by(await tx.journalEntry.groupBy({ by: ["basCode"], where, _count: { _all: true } })));
  add(
    (
      await tx.partner.groupBy({
        by: ["defaultBasCategoryCode"],
        where,
        _count: { _all: true },
      })
    ).map((r) => ({ code: r.defaultBasCategoryCode, n: r._count._all })),
  );
  return counts;
}
