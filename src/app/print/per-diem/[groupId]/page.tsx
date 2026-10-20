// The print mode of the per-diem breakdown (D29), served to Chromium by kernel/pdf. Token-authenticated.
import { notFound } from "next/navigation";
import { requirePrintCaller } from "@/kernel/auth/print-caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { getUserPreferences } from "@/modules/settings";
import { resolvePerDiemStatement } from "@/modules/traktamente";
import { PerDiemSheet } from "@/modules/traktamente/ui";

type Params = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PrintPerDiemPage({ params, searchParams }: Params) {
  const { groupId } = await params;
  const caller = await requirePrintCaller(searchParams, `/print/per-diem/${groupId}`);
  const data = await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
    const [statement, prefs] = await Promise.all([
      resolvePerDiemStatement(tx, caller, groupId),
      getUserPreferences(tx, caller),
    ]);
    return { statement, locale: (prefs.data?.locale ?? null) as "en" | "fr" | null };
  });
  if (!data.statement) notFound();
  return (
    <main className="bg-white">
      <PerDiemSheet data={data.statement} locale={data.locale} />
    </main>
  );
}
