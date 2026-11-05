import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { expensePageOptions, ledgerSnapshot, openPrivateExpenses } from "@/modules/expenses";
import { SettleWork } from "@/modules/expenses/ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The settle work page (specs/expenses US4, US5): open private expenses left, the refund row right. `?row=<id>`
// (F131 §5.1, *This row refunds me* on the bank row) preselects and locks that row.
export default async function SettlePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "create", subject: "settlement" });
  const params = await searchParams;
  const row = typeof params.row === "string" && UUID.test(params.row) ? params.row : null;
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
      lockedTransactionId={row}
    />
  );
}
