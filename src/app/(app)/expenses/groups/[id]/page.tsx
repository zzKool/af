import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCaller } from "@/kernel/auth/caller";
import { can } from "@/kernel/auth/can";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { translator } from "@/kernel/i18n/translate";
import { parseListQuery } from "@/kernel/list-query/codec";
import { formatCurrency } from "@/kernel/money/format-currency";
import { EntityPage } from "@/kernel/ui/shell/page";
import {
  EXPENSE_COLUMN_KEYS,
  EXPENSE_DEFAULT_SORT,
  expensePageOptions,
  getExpense,
  getGroupDetail,
  listExpenses,
} from "@/modules/expenses";
import { ExpenseTable, GroupHeaderActions } from "@/modules/expenses/ui";
import { getUserPreferences } from "@/modules/settings";
import { listForGroup } from "@/modules/supplier-invoices";
import { SupplierInvoiceGroupSection } from "@/modules/supplier-invoices/ui";
import { countryOptions, getTrip, toLocal } from "@/modules/traktamente";
import { TripPanel } from "@/modules/traktamente/ui";

// The group page: header with totals, the trip panel (trip groups), the group's expenses.
export default async function ExpenseGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const auth = await requireCaller({ action: "read", subject: "expense" });
  const query = parseListQuery(await searchParams, {
    columns: EXPENSE_COLUMN_KEYS,
    defaultSort: EXPENSE_DEFAULT_SORT,
  });
  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const group = await getGroupDetail(tx, id);
    if (group.error) return null;
    const [result, options, prefs, trip, supplierInvoices] = await Promise.all([
      listExpenses(tx, query, { groupId: id }),
      expensePageOptions(tx, auth),
      getUserPreferences(tx, auth),
      getTrip(tx, id),
      listForGroup(tx, id),
    ]);
    const year = trip
      ? toLocal(trip.departureAt).date.slice(0, 4)
      : String(new Date().getFullYear());
    const countries = await countryOptions(tx, Number(year), "en");
    const perDiem = trip?.perDiemExpenseId ? await getExpense(tx, trip.perDiemExpenseId) : null;
    return {
      group: group.data,
      result,
      options,
      prefs,
      trip,
      countries,
      perDiem,
      supplierInvoices,
    };
  });
  if (!data) notFound();
  const t = translator(data.prefs.data?.locale ?? null);
  const locale = (data.prefs.data?.locale ?? null) as "en" | "fr" | null;
  const canWrite = can(auth, "update", "expense");
  const g = data.group;
  const local = (d: Date) => {
    const l = toLocal(d);
    return `${l.date}T${String(Math.floor(l.minutes / 60)).padStart(2, "0")}:${String(l.minutes % 60).padStart(2, "0")}`;
  };

  return (
    <EntityPage
      back={<Link href="/expenses/groups">{t("expenses.group.back")}</Link>}
      title={g.label}
      meta={t("expenses.group.meta", {
        count: g.expenseCount,
        total: formatCurrency(g.totalBase, "SEK"),
        open: formatCurrency(g.openBase, "SEK"),
      })}
      actions={
        <GroupHeaderActions
          group={{ id: g.id, description: g.description, kind: g.kind, hasTrip: g.hasTrip }}
          canWrite={canWrite}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {(g.kind === "trip" || data.trip) && (
          <TripPanel
            groupId={g.id}
            trip={
              data.trip
                ? {
                    ...data.trip,
                    departureAt: local(data.trip.departureAt),
                    returnAt: local(data.trip.returnAt),
                  }
                : null
            }
            countries={data.countries}
            categories={data.options.categories}
            perDiemExpense={
              data.perDiem
                ? { id: data.perDiem.id, key: data.perDiem.key, amount: data.perDiem.amount }
                : null
            }
            canWrite={canWrite}
            locale={locale}
          />
        )}
        <SupplierInvoiceGroupSection
          rows={data.supplierInvoices.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        />
        <ExpenseTable
          result={{
            ...data.result,
            rows: data.result.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
          }}
          ledger={null}
          {...data.options}
          canWrite={canWrite}
          groupId={g.id}
          hideKpis
        />
      </div>
    </EntityPage>
  );
}
