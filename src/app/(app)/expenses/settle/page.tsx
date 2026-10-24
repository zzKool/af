import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { expensePageOptions, ledgerSnapshot, openPrivateExpenses } from "@/modules/expenses";
import { SettleWork } from "@/modules/expenses/ui";

// The settle work page (specs/expenses US4, US5): open private expenses left, the refund row right.
export default async function SettlePage() {
  const auth = await requireCaller({ action: "create", subject: "settlement" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const open = await openPrivateExpenses(tx);
    const options = await expensePageOptions(tx, auth, { documents: false });
    const ledger = await ledgerSnapshot(tx);
    return { open, options, ledger };
  });
  return (
    <SettleWork
      open={data.open}
      transactions={data.options.transactions}
      sources={data.options.sources}
      ledgerOpen={data.ledger.total.openBase}
      ledgerCount={data.ledger.total.openCount}
    />
  );
}
