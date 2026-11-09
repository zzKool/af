import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { createClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { formatMonth } from "@/kernel/i18n/format-date";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator, uiLanguage } from "@/kernel/i18n/translate";
import { ListPage } from "@/kernel/ui/shell/page";
import {
  bankMonths,
  categoryOptions,
  getTransaction,
  partnerOptions,
  STATEMENT_ROLES,
} from "@/modules/banking";
import { justifyOptions, reconcileData } from "@/modules/linking";
import { ReconcileMonthNav, ReconcilePage } from "@/modules/linking/ui";
import { getUserPreferences } from "@/modules/settings";

// Reconcile — the match stage (F139, specs/linking/reconcile.md, D76 phase 5): one month's rows to justify, grouped,
// the row in focus on the stage. `?month=yyyy-mm`; `?row=<id>` focuses a row (and opens its month); without either,
// the oldest month with a row to justify. Computed on request (`reconcileData`); the accountant reads, the owner acts.
export default async function ReconcileRoute({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; row?: string }>;
}) {
  const auth = await requireCaller({ action: "read", subject: "bank_transaction" });
  const today = createClock().today();
  const params = await searchParams;
  const asked = params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : null;
  const rowId = params.row && /^[0-9a-f-]{36}$/i.test(params.row) ? params.row : null;
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    // a row asked for opens its own month
    const row = !asked && rowId ? await getTransaction(tx, rowId) : null;
    const month = asked ?? row?.data?.transaction.bookingDate.slice(0, 7) ?? null;
    const reconcile = await reconcileData(tx, today, month);
    const categories = await categoryOptions(tx, auth);
    const partners = await partnerOptions(tx);
    const prefs = await getUserPreferences(tx, auth);
    const justify = can(auth, "create", "link") ? await justifyOptions(tx, auth) : null;
    // F159: the strip on top — the month's day cells per statement account (the bank's Months read)
    const months = await bankMonths(tx, { today });
    const strip = {
      accounts: months.accounts
        .filter((a) => STATEMENT_ROLES.includes(a.role))
        .map(({ id, label, currency }) => ({ id, label, currency })),
      days: months.days
        .filter((d) => d.date.startsWith(reconcile.month))
        .map(({ date, bankAccountId, rows, toJustify }) => ({
          date,
          bankAccountId,
          rows,
          toJustify,
        })),
    };
    return { reconcile, categories, partners, prefs, justify, strip };
  });
  const locale = await requestLocale(data.prefs.data?.locale);
  const t = translator(locale);
  const r = data.reconcile;
  const month = formatMonth(r.month, uiLanguage(locale));
  const total = r.progress.justified + r.progress.toJustify;

  return (
    <ListPage
      ground
      title={t("reconcile.title", { month })}
      meta={
        r.rows.length > 0
          ? t("reconcile.meta", { left: r.rows.length, done: r.progress.justified, total, month })
          : t("reconcile.metaDone", { month })
      }
      back={<Link href="/banking">← {t("banking.title")}</Link>}
      actions={<ReconcileMonthNav data={r} />}
    >
      <ReconcilePage
        data={r}
        partners={data.partners}
        categories={data.categories}
        justifyOptions={data.justify}
        canWrite={can(auth, "create", "bank_transaction")}
        initialRowId={rowId}
        strip={data.strip}
      />
    </ListPage>
  );
}
