import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { Kpi, KpiRow, TableCard } from "@/kernel/ui/pulse";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  categoryOptions,
  listRules,
  listRulesPage,
  partnerOptions,
  RULE_COLUMN_KEYS,
  RULE_DEFAULT_SORT,
  ruleAccountOptions,
  ruleNearMisses,
} from "@/modules/banking";
import { RuleNearMisses, RulesActions, RulesTable } from "@/modules/banking/ui";
import { getUserPreferences } from "@/modules/settings";

// Categorisation rules — the order they run in, new / edit / delete, apply with dry run (specs/banking US2).
export default async function BankRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const query = parseListQuery(await searchParams, {
    columns: RULE_COLUMN_KEYS,
    defaultSort: RULE_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listRulesPage(tx, query);
    const categories = await categoryOptions(tx, auth);
    const partners = await partnerOptions(tx);
    const accounts = await ruleAccountOptions(tx);
    const nearMisses = await ruleNearMisses(tx);
    // F129: *Needs a look* edits a no-proof rule without a partner in place — every rule, a handful
    const rules = nearMisses.some((m) => m.reason === "no_partner")
      ? (await listRules(tx)).map((r) => ({
          id: r.id,
          name: r.name,
          matchType: r.matchType,
          matchPattern: r.matchPattern,
          matchField: r.matchField,
          basCode: r.basCode,
          partnerId: r.partnerId,
          noDocumentNeeded: r.noDocumentNeeded,
          priority: r.priority,
          bankAccountId: r.bankAccountId,
          sign: r.sign,
          expectedAmount: r.expectedAmount,
          tolerancePct: r.tolerancePct,
          cadence: r.cadence,
        }))
      : [];
    const prefs = await getUserPreferences(tx, auth);
    // F165: the hero — the rules, how many work, what they did
    const all = await listRulesPage(tx, { page: 1, pageSize: 1000, sort: [], filters: {} });
    return { result, categories, partners, accounts, nearMisses, rules, prefs, all: all.rows };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "update", "bank_transaction");

  return (
    <ListPage
      ground
      title={t("banking.rules.title")}
      meta={t("banking.rules.meta", { count: data.result.total })}
      actions={
        canWrite && (
          <RulesActions
            categories={data.categories}
            partners={data.partners}
            accounts={data.accounts}
          />
        )
      }
    >
      <div className="flex flex-col gap-[18px]">
        <KpiRow testId="rules-hero">
          <Kpi
            label={t("banking.rules.pulse.rules")}
            value={data.all.length}
            sub={t("banking.rules.pulse.active", {
              count: data.all.filter((r) => r.isActive).length,
            })}
          />
          <Kpi
            label={t("banking.rules.pulse.hits")}
            value={data.all.reduce((s, r) => s + r.hitCount, 0)}
            tone="done"
            sub={t("banking.rules.pulse.hitsSub")}
          />
          <Kpi
            label={t("banking.rules.pulse.noProof")}
            value={data.all.filter((r) => r.isActive && r.noDocumentNeeded).length}
            sub={t("banking.rules.pulse.noProofSub")}
          />
          <Kpi
            label={t("banking.rules.pulse.nearMisses")}
            value={data.nearMisses.length}
            tone={data.nearMisses.length > 0 ? "attention" : "done"}
            sub={t("banking.rules.pulse.nearMissesSub")}
          />
        </KpiRow>
        <RuleNearMisses
          misses={data.nearMisses}
          rules={data.rules}
          categories={data.categories}
          partners={data.partners}
          accounts={data.accounts}
          canWrite={canWrite}
        />
        <TableCard>
          <RulesTable
            result={{
              ...data.result,
              rows: data.result.rows.map((r) => ({
                ...r,
                lastHitAt: r.lastHitAt ? r.lastHitAt.toISOString() : null,
                createdAt: r.createdAt.toISOString(),
                updatedAt: r.updatedAt.toISOString(),
              })),
            }}
            categories={data.categories}
            partners={data.partners}
            accounts={data.accounts}
            canWrite={canWrite}
          />
        </TableCard>
      </div>
    </ListPage>
  );
}
