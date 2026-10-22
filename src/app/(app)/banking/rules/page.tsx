import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import { listRulesWithLabels } from "@/modules/banking";
import { RulesTable } from "@/modules/banking/ui";
import { categoryOptions, partnerOptions } from "@/modules/journal";
import { getUserPreferences } from "@/modules/settings";

// Categorisation rules — priority order, new / edit / delete, apply with dry run (specs/banking US2).
export default async function BankRulesPage() {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const [rules, categories, partners, prefs] = await Promise.all([
      listRulesWithLabels(tx),
      categoryOptions(tx, auth),
      partnerOptions(tx),
      getUserPreferences(tx, auth),
    ]);
    return { rules, categories, partners, prefs };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));

  return (
    <ListPage
      title={t("banking.rules.title")}
      back={<Link href="/banking">← {t("banking.title")}</Link>}
      meta={t("banking.rules.meta", { count: data.rules.length })}
    >
      <RulesTable
        rules={data.rules.map((r) => ({
          ...r,
          lastHitAt: r.lastHitAt ? r.lastHitAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }))}
        categories={data.categories}
        partners={data.partners}
        canWrite={can(auth, "update", "bank_transaction")}
      />
    </ListPage>
  );
}
