"use client";

// The partner's 360° page (D40 entity archetype): the title row — the state, the types as tags, ⋮ with
// Deactivate / Reactivate, the graph link — and underline tabs with count badges. The breadcrumb names the
// parent, so there is no back link and the title shows once.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import { RowActionsMenu } from "@/kernel/ui/data-table";
import { DetailsGrid } from "@/kernel/ui/details-section";
import { PageHeader } from "@/kernel/ui/shell/page";
import { CountBadge, Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { ContractList, type ContractRow } from "@/modules/contracts/ui";
import { GraphLink } from "@/modules/linking/ui";
import {
  type PartnerContactRow,
  PartnerContacts,
} from "@/modules/partners/components/partner-contacts";
import {
  type PartnerDocument,
  PartnerDocuments,
} from "@/modules/partners/components/partner-documents";
import {
  type PartnerExpenses,
  PartnerExpensesTab,
} from "@/modules/partners/components/partner-expenses";
import { type PartnerData, PartnerForm } from "@/modules/partners/components/partner-form";
import {
  deactivatePartnerAction,
  reactivatePartnerAction,
} from "@/modules/partners/partners.actions";
import { PartnerStateLabel, PartnerTypeTags } from "./partner-labels";

/** the books' base currency — read once here, for the transactions and the expenses tabs (F85) */
const BASE = BASE_CURRENCY;

type BasOption = { code: string; label: string };
type VatOption = { id: string; label: string };
type EmployeeOption = { id: string; name: string };
/** a bank row that names the partner (F113) — the newest first, capped by the page */
export type PartnerTransactionRow = {
  id: string;
  bookingDate: string;
  description: string;
  amount: string;
  currency: string;
  amountBase: string;
  basLabel: string | null;
};

interface PartnerDetailTabsProps {
  partner: PartnerData;
  contracts: ContractRow[];
  contacts: PartnerContactRow[];
  vatRegistrations: VatOption[];
  employeePartners: EmployeeOption[];
  basOptions: BasOption[];
  defaultCurrency: string | null;
  documents: PartnerDocument[];
  transactions: { total: number; rows: PartnerTransactionRow[] };
  /** spend with this partner (F87) — the expenses module's read, composed by the page */
  expenses: PartnerExpenses;
  /** F144 (the board *Partner*): the invoicing figures, composed by the page from the invoices module */
  figures?: ReactNode;
  /** F144: twelve months of invoiced and paid, what happened */
  activity?: ReactNode;
  /** F144: the partner's invoices and credit notes, for *Linked* */
  invoiceCount?: number;
}

export function PartnerDetailTabs({
  partner,
  contracts,
  contacts,
  vatRegistrations,
  employeePartners,
  basOptions,
  defaultCurrency,
  documents,
  transactions,
  expenses,
  figures,
  activity,
  invoiceCount,
}: PartnerDetailTabsProps) {
  const t = useT();
  const router = useRouter();
  const [isActive, setIsActive] = useState(partner.isActive);
  const [displayName, setDisplayName] = useState(partner.name);
  const [types, setTypes] = useState<string[]>(partner.types);
  const [contactCount, setContactCount] = useState(contacts.length);
  const { executeAsync: execDeactivate } = useAction(deactivatePartnerAction);
  const { executeAsync: execReactivate } = useAction(reactivatePartnerAction);

  const { dialogProps, confirm } = useConfirmDialog({
    title: t("partners.deactivateConfirm.title"),
    variant: "destructive",
    confirmLabel: t("partners.deactivate"),
  });

  const isClient = types.includes("client");
  const activeContractCount = contracts.filter((c) => c.isActive).length;

  const handleDeactivate = useCallback(() => {
    confirm(
      async () => {
        const error = extractError(await execDeactivate({ id: partner.id }));
        if (error) throw new Error(error);
        setIsActive(false);
        toast.success(t("partners.deactivated", { name: displayName }));
        router.refresh();
      },
      { description: t("partners.deactivateConfirm.description", { name: displayName }) },
    );
  }, [confirm, execDeactivate, partner.id, displayName, router, t]);

  const handleReactivate = useCallback(async () => {
    const error = extractError(await execReactivate({ id: partner.id }));
    if (error) {
      toast.error(error);
      return;
    }
    setIsActive(true);
    toast.success(t("partners.reactivated", { name: displayName }));
    router.refresh();
  }, [execReactivate, partner.id, displayName, router, t]);

  const handleSaved = useCallback((patch: { name?: string; types?: string[] }) => {
    if (patch.name !== undefined) setDisplayName(patch.name);
    if (patch.types !== undefined) setTypes(patch.types);
  }, []);

  return (
    <Tabs defaultValue="overview" className="gap-4">
      <PageHeader
        title={displayName}
        tags={
          <>
            <PartnerStateLabel isActive={isActive} />
            <PartnerTypeTags types={types} systemRole={partner.systemRole ?? null} />
          </>
        }
        actions={
          <>
            <RowActionsMenu
              label={t("shell.more")}
              actions={[
                isActive
                  ? {
                      label: t("partners.deactivate"),
                      destructive: true,
                      onClick: handleDeactivate,
                    }
                  : { label: t("partners.reactivate"), onClick: () => void handleReactivate() },
              ]}
            />
            <GraphLink self={{ type: "partner", id: partner.id }} />
            {types.includes("client") && isActive && (
              <Link
                href={`/invoices/new?type=invoice&partner=${partner.id}`}
                className={buttonVariants()}
                data-testid="partner-new-invoice"
              >
                {t("partners.insight.newInvoice")}
              </Link>
            )}
          </>
        }
        tabs={
          <TabsList>
            <TabsTrigger value="overview">{t("partners.tab.overview")}</TabsTrigger>
            <TabTrigger
              value="contracts"
              label={t("partners.tab.contractList")}
              count={contracts.length}
            />
            <TabTrigger value="contacts" label={t("partners.tab.contacts")} count={contactCount} />
            <TabTrigger
              value="transactions"
              label={t("partners.tab.transactions")}
              count={transactions.total}
            />
            <TabTrigger
              value="expenses"
              label={t("partners.tab.expenses")}
              count={expenses.count}
            />
            <TabTrigger
              value="documents"
              label={t("partners.tab.documents")}
              count={documents.length}
            />
          </TabsList>
        }
      />

      <TabsContent value="overview" className="flex flex-col gap-[18px]">
        {figures}
        <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-[18px]">
            {activity}
            <section className={CARD}>
              <h2 className="mb-3 text-sm font-semibold">{t("partners.insight.details")}</h2>
              <DetailsGrid
                rows={[
                  [t("partners.col.status"), <PartnerStateLabel key="s" isActive={isActive} />],
                  [
                    t("partners.col.types"),
                    <PartnerTypeTags
                      key="t"
                      types={types}
                      systemRole={partner.systemRole ?? null}
                    />,
                  ],
                  [
                    t("partners.overview.activeContracts"),
                    <span key="c" className="tabular-nums">
                      {activeContractCount}
                    </span>,
                  ],
                  [
                    t("partners.col.created"),
                    <span key="d" className="tabular-nums">
                      {partner.createdAt.slice(0, 10)}
                    </span>,
                  ],
                ]}
              />
              <PartnerForm partner={partner} basOptions={basOptions} onSaved={handleSaved} />
            </section>
          </div>
          <aside className="flex flex-col gap-[18px]">
            <ContractCard contract={contracts.find((c) => c.isActive) ?? null} />
            <section className={CARD} data-testid="partner-linked">
              <h2 className="mb-2 text-sm font-semibold">{t("partners.insight.linked")}</h2>
              <ul className="flex flex-col gap-1 text-[13px] tabular-nums">
                {invoiceCount !== undefined && (
                  <li>{t("partners.insight.linkedInvoices", { count: invoiceCount })}</li>
                )}
                <li>{t("partners.insight.linkedBank", { count: transactions.total })}</li>
                <li>{t("partners.insight.linkedDocuments", { count: documents.length })}</li>
                <li>{t("partners.insight.linkedContracts", { count: contracts.length })}</li>
              </ul>
            </section>
          </aside>
        </div>
      </TabsContent>

      <TabsContent value="contracts">
        {isClient ? (
          <ContractList
            partnerId={partner.id}
            contracts={contracts}
            vatRegistrations={vatRegistrations}
            employeePartners={employeePartners}
            defaultCurrency={defaultCurrency}
          />
        ) : (
          <Empty>{t("partners.contracts.notClient")}</Empty>
        )}
      </TabsContent>

      <TabsContent value="contacts">
        <PartnerContacts
          partnerId={partner.id}
          contacts={contacts}
          onCountChange={setContactCount}
        />
      </TabsContent>

      <TabsContent value="transactions">
        {transactions.rows.length === 0 ? (
          <Empty>{t("partners.transactions.empty")}</Empty>
        ) : (
          <div className="flex flex-col gap-2" data-testid="partner-transactions">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("partners.transactions.showing", {
                  shown: transactions.rows.length,
                  total: transactions.total,
                })}
              </span>
              <Link
                href={`/banking?f.partnerId=in:${partner.id}`}
                className="text-primary hover:underline"
              >
                {t("partners.transactions.openJournal")}
              </Link>
            </div>
            <ul className="rounded-lg border text-[13px]">
              {transactions.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex min-h-8 items-center justify-between gap-3 border-b border-subtle px-3 py-1 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {r.bookingDate}
                    </span>
                    <span className="truncate" title={r.description}>
                      {r.description}
                    </span>
                    {r.basLabel && <Tag className="shrink-0">{r.basLabel}</Tag>}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 text-right tabular-nums">
                    <span data-amount={r.amount}>{formatMoney(r.amount, r.currency)}</span>
                    {r.currency !== BASE && (
                      <span className="text-xs text-muted-foreground" data-amount={r.amountBase}>
                        {formatMoney(r.amountBase, BASE)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TabsContent>

      <TabsContent value="expenses">
        <PartnerExpensesTab partnerId={partner.id} expenses={expenses} baseCurrency={BASE} />
      </TabsContent>

      <TabsContent value="documents">
        {documents.length === 0 ? (
          <Empty>{t("partners.documents.empty")}</Empty>
        ) : (
          <PartnerDocuments documents={documents} />
        )}
      </TabsContent>

      <ConfirmDialog {...dialogProps} />
    </Tabs>
  );
}

const CARD = "rounded-2xl border border-subtle bg-surface p-4 shadow-card";

/** F144: the active contract at a glance — the rate, the period, the references the client asks for, the terms. */
function ContractCard({ contract: c }: { contract: ContractRow | null }) {
  const t = useT();
  if (!c)
    return (
      <section className={CARD} data-testid="partner-contract">
        <p className="text-[13px] text-muted-foreground">{t("partners.insight.noContract")}</p>
      </section>
    );
  const rows: [string, ReactNode][] = [];
  if (c.currentRate)
    rows.push([
      t("partners.insight.rate"),
      <span key="r" className="tabular-nums">
        {formatMoney(c.currentRate.rate, c.currency ?? BASE)}
      </span>,
    ]);
  rows.push([
    t("partners.insight.period"),
    <span key="p" className="tabular-nums">
      {c.startDate} → {c.endDate ?? "…"}
    </span>,
  ]);
  for (const r of c.externalReferences) rows.push([r.label, <span key={r.label}>{r.value}</span>]);
  if (c.paymentTerms)
    rows.push([
      t("partners.insight.terms"),
      /^\d+$/.test(c.paymentTerms)
        ? t("partners.insight.termsDays", { count: Number(c.paymentTerms) })
        : c.paymentTerms,
    ]);
  return (
    <section className={CARD} data-testid="partner-contract">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {t("partners.insight.contract", { name: c.name })}
        <Tag>{c.currency ?? BASE}</Tag>
      </h2>
      <DetailsGrid rows={rows} />
    </section>
  );
}

/** An underline tab with its count as a badge (D40) — the accessible name is "Contacts 2" (a space before the badge). */
function TabTrigger({ value, label, count }: { value: string; label: string; count: number }) {
  return (
    <TabsTrigger value={value}>
      {label} <CountBadge count={count} />
    </TabsTrigger>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border px-3 py-6 text-center text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}
