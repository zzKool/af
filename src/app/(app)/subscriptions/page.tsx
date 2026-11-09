import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { tenantProfile } from "@/kernel/db/tenant";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { CURRENCIES } from "@/kernel/nav/constants";
import { TableCard } from "@/kernel/ui/pulse";
import { ListPage } from "@/kernel/ui/shell/page";
import { getExpense } from "@/modules/expenses";
import { rateToBase } from "@/modules/rates";
import { getUserPreferences } from "@/modules/settings";
import {
  listSubscriptions,
  SUBSCRIPTION_COLUMN_KEYS,
  SUBSCRIPTION_DEFAULT_SORT,
  subscriptionPageOptions,
  subscriptionsOverviewFrom,
} from "@/modules/subscriptions";
import {
  ConfirmAllExactButton,
  NewSubscriptionButton,
  type SubscriptionFormInitial,
  SubscriptionsHero,
  SubscriptionTable,
} from "@/modules/subscriptions/ui";
import { getSupplierInvoice } from "@/modules/supplier-invoices";

// The subscriptions list (specs/subscriptions FR-013): every column derived server-side; `?open=<id>` opens a
// panel, `?new=1` the form, `?new=1&from=expense:<id>` (or `supplier_invoice:<id>`) the form pre-filled from that
// entity — *Make it recurring* (US1-5).
export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireCaller({ action: "read", subject: "subscription" });
  const params = await searchParams;
  const query = parseListQuery(params, {
    columns: SUBSCRIPTION_COLUMN_KEYS,
    defaultSort: SUBSCRIPTION_DEFAULT_SORT,
  });
  const today = createClock().today();
  const from = typeof params.from === "string" ? params.from.split(":") : null;
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const result = await listSubscriptions(tx, auth, query, today);
    const options = await subscriptionPageOptions(tx, auth);
    const prefs = await getUserPreferences(tx, auth);
    let initial: SubscriptionFormInitial | null = null;
    if (from?.[0] === "expense" && from[1]) {
      const e = await getExpense(tx, from[1]);
      if (e)
        initial = {
          name: e.description,
          partnerId: e.partnerId ?? undefined,
          becomes: "expense",
          basCode: e.basCode,
          groupId: e.groupId,
          paidFromAccountId: e.paidFromAccountId,
          startDate: e.date,
          amount: e.amount,
          currency: e.currency,
          entity: { type: "expense", id: e.id, key: e.key },
        };
    } else if (from?.[0] === "supplier_invoice" && from[1]) {
      const si = await getSupplierInvoice(tx, from[1]);
      if (si)
        initial = {
          partnerId: si.partnerId,
          becomes: "supplier_invoice",
          basCode: si.basCode,
          groupId: si.groupId,
          startDate: si.invoiceDate,
          amount: si.amountTotal,
          currency: si.currency,
          entity: { type: "supplier_invoice", id: si.id, key: si.key },
        };
    }
    // F164: the hero — a month of the running subscriptions in the base, at today's ECB rate
    const base = (await tenantProfile(tx, auth.tenantId))?.currency ?? CURRENCIES[0];
    const all = await listSubscriptions(
      tx,
      auth,
      { page: 1, pageSize: 1000, sort: [], filters: {} },
      today,
    );
    const rates = new Map<string, string | null>();
    for (const c of new Set(
      all.rows.flatMap((r) => (r.expectedCurrency ? [r.expectedCurrency] : [])),
    ))
      rates.set(c, (await rateToBase(tx, today, c, base))?.rate.toFixed(6) ?? null);
    const overview = subscriptionsOverviewFrom(all.rows, (c) => rates.get(c) ?? null);
    return { result, options, prefs, initial, overview, base };
  });
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const canWrite = can(auth, "create", "subscription");

  return (
    <ListPage
      ground
      title={t("subscriptions.title")}
      meta={t("subscriptions.meta.count", { count: data.result.total })}
      actions={
        canWrite && (
          <>
            <ConfirmAllExactButton />
            <NewSubscriptionButton options={data.options} initial={data.initial} />
          </>
        )
      }
    >
      <div className="flex flex-col gap-[18px]">
        <SubscriptionsHero o={data.overview} base={data.base} />
        <TableCard>
          <SubscriptionTable
            result={data.result}
            canWrite={canWrite}
            initialSelectedId={typeof params.open === "string" ? params.open : null}
          />
        </TableCard>
      </div>
    </ListPage>
  );
}
