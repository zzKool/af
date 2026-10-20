// The print mode of the reimbursement statement, served to Chromium by kernel/pdf (docs/pdf.md). Token-
// authenticated: the renderer mints a 120 s token bound to this path; anything else 404s. No client JS.
import { notFound } from "next/navigation";
import { requirePrintCaller } from "@/kernel/auth/print-caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { resolveStatement } from "@/modules/expenses";
import { StatementSheet } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PrintSettlementPage({ params, searchParams }: Params) {
  const { id } = await params;
  const caller = await requirePrintCaller(searchParams, `/print/settlement/${id}`);
  const data = await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
    const [statement, prefs] = await Promise.all([
      resolveStatement(tx, caller, id),
      getUserPreferences(tx, caller),
    ]);
    return { statement, locale: (prefs.data?.locale ?? null) as "en" | "fr" | null };
  });
  if (!data.statement) notFound();
  return (
    <main className="bg-white">
      <StatementSheet data={data.statement} locale={data.locale} />
    </main>
  );
}
