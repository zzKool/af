import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { EntityPage } from "@/kernel/ui/shell/page";
import { resolveStatement } from "@/modules/expenses";
import { StatementSheet } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";

// The settlement page: the statement as it prints (read-only; the PDF is the stored document).
export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireCaller({ action: "read", subject: "settlement" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [statement, prefs] = await Promise.all([
      resolveStatement(tx, auth, id),
      getUserPreferences(tx, auth),
    ]);
    return { statement, prefs };
  });
  if (!data.statement) notFound();
  const locale = (data.prefs.data?.locale ?? null) as "en" | "fr" | null;
  const t = translator(await requestLocale(data.prefs.data?.locale));
  return (
    <EntityPage
      back={<Link href="/expenses/settlements">← {t("expenses.settlements.title")}</Link>}
      title={data.statement.number}
      meta={`${t("expenses.statement.payee")} ${data.statement.payee} · ${data.statement.refund.bookingDate}`}
    >
      <div className="bg-muted/30 p-4">
        <StatementSheet data={data.statement} locale={locale} />
      </div>
    </EntityPage>
  );
}
