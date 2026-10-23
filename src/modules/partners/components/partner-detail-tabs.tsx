"use client";

// The partner's 360° page (D40 entity archetype): the title row — the state, the types as tags, ⋮ with
// Deactivate / Reactivate, the graph link — and underline tabs with count badges. The breadcrumb names the
// parent, so there is no back link and the title shows once.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { extractError } from "@/kernel/errors/extract-error";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { BASE_CURRENCY } from "@/kernel/nav/constants";
import { RowActionsMenu } from "@/kernel/ui/data-table";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { PageHeader } from "@/kernel/ui/shell/page";
import { CodeChip, CountBadge, Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { ContractList, type ContractRow } from "@/modules/contracts/ui";
import { GraphLink } from "@/modules/linking/ui";
import {
  type PartnerContactRow,
  PartnerContacts,
} from "@/modules/partners/components/partner-contacts";
import { type PartnerData, PartnerForm } from "@/modules/partners/components/partner-form";
import {
  deactivatePartnerAction,
  reactivatePartnerAction,
} from "@/modules/partners/partners.actions";
import { PartnerStateLabel, PartnerTypeTags } from "./partner-labels";

type BasOption = { code: string; label: string };
type VatOption = { id: string; label: string };
type EmployeeOption = { id: string; name: string };
/** a document linked to the partner (belongs_to) — plain facts from the documents module */
export type PartnerDocument = {
  id: string;
  businessKey: string;
  fileName: string;
  documentType: string;
  status: string;
};
/** a journal entry that names the partner — the newest first, capped by the page */
export type PartnerJournalRow = {
  id: string;
  entryDate: string;
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
  journal: { total: number; rows: PartnerJournalRow[] };
}

const DOCUMENT_CATEGORY: Readonly<Record<string, MessageKey>> = {
  financial: "documents.category.financial",
  relationship: "documents.category.relationship",
};

export function PartnerDetailTabs({
  partner,
  contracts,
  contacts,
  vatRegistrations,
  employeePartners,
  basOptions,
  defaultCurrency,
  documents,
  journal,
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
            <PartnerTypeTags types={types} />
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
              count={journal.total}
            />
            <TabTrigger
              value="documents"
              label={t("partners.tab.documents")}
              count={documents.length}
            />
          </TabsList>
        }
      />

      <TabsContent value="overview">
        <DetailsSection title={t("details.about")} className="border-t-0 pt-0">
          <DetailsGrid
            rows={[
              [t("partners.col.status"), <PartnerStateLabel key="s" isActive={isActive} />],
              [t("partners.col.types"), <PartnerTypeTags key="t" types={types} />],
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
        </DetailsSection>
        <PartnerForm partner={partner} basOptions={basOptions} onSaved={handleSaved} />
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
        {journal.rows.length === 0 ? (
          <Empty>{t("partners.transactions.empty")}</Empty>
        ) : (
          <div className="flex flex-col gap-2" data-testid="partner-transactions">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("partners.transactions.showing", {
                  shown: journal.rows.length,
                  total: journal.total,
                })}
              </span>
              <Link
                href={`/journal?f.partnerId=in:${partner.id}`}
                className="text-primary hover:underline"
              >
                {t("partners.transactions.openJournal")}
              </Link>
            </div>
            <ul className="rounded-lg border text-[13px]">
              {journal.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex min-h-8 items-center justify-between gap-3 border-b border-subtle px-3 py-1 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {r.entryDate}
                    </span>
                    <span className="truncate" title={r.description}>
                      {r.description}
                    </span>
                    {r.basLabel && <Tag className="shrink-0">{r.basLabel}</Tag>}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 text-right tabular-nums">
                    <span data-amount={r.amount}>{formatMoney(r.amount, r.currency)}</span>
                    {r.currency !== BASE_CURRENCY && (
                      <span className="text-xs text-muted-foreground" data-amount={r.amountBase}>
                        {formatMoney(r.amountBase, BASE_CURRENCY)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TabsContent>

      <TabsContent value="documents">
        {documents.length === 0 ? (
          <Empty>{t("partners.documents.empty")}</Empty>
        ) : (
          <ul className="rounded-lg border text-[13px]" data-testid="partner-documents">
            {documents.map((d) => {
              const category = DOCUMENT_CATEGORY[d.documentType];
              return (
                <li
                  key={d.id}
                  className="flex min-h-8 items-center justify-between gap-3 border-b border-subtle px-3 py-1 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Link href={`/documents/${d.id}`} className="shrink-0 hover:underline">
                      <CodeChip>{d.businessKey}</CodeChip>
                    </Link>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {d.fileName}
                    </span>
                  </span>
                  {category && <Tag className="shrink-0">{t(category)}</Tag>}
                </li>
              );
            })}
          </ul>
        )}
      </TabsContent>

      <ConfirmDialog {...dialogProps} />
    </Tabs>
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
