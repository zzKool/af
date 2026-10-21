"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { ContractList, type ContractRow } from "@/modules/contracts/ui";
import { GraphLink } from "@/modules/linking/ui";
import { type PartnerData, PartnerForm } from "@/modules/partners/components/partner-form";
import {
  deactivatePartnerAction,
  reactivatePartnerAction,
} from "@/modules/partners/partners.actions";

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
  vatRegistrations: VatOption[];
  employeePartners: EmployeeOption[];
  basOptions: BasOption[];
  defaultCurrency: string | null;
  documents: PartnerDocument[];
  journal: { total: number; rows: PartnerJournalRow[] };
}

export function PartnerDetailTabs({
  partner,
  contracts,
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
  const { executeAsync: execDeactivate } = useAction(deactivatePartnerAction);
  const { executeAsync: execReactivate } = useAction(reactivatePartnerAction);

  const { dialogProps, confirm } = useConfirmDialog({
    title: t("partners.deactivateConfirm.title"),
    variant: "destructive",
    confirmLabel: t("partners.deactivate"),
  });

  const isClient = partner.types.includes("client");
  const activeContractCount = contracts.filter((c) => c.isActive).length;

  const handleDeactivate = useCallback(() => {
    confirm(
      async () => {
        const result = await execDeactivate({ id: partner.id });
        const error = extractError(result);
        if (error) throw new Error(error);
        setIsActive(false);
        toast.success(t("partners.deactivated", { name: displayName }));
        router.refresh();
      },
      {
        description: t("partners.deactivateConfirm.description", { name: displayName }),
      },
    );
  }, [confirm, execDeactivate, partner.id, displayName, router, t]);

  const handleReactivate = useCallback(async () => {
    const result = await execReactivate({ id: partner.id });
    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }
    setIsActive(true);
    toast.success(t("partners.reactivated", { name: displayName }));
    router.refresh();
  }, [execReactivate, partner.id, displayName, router, t]);

  const handleNameSaved = useCallback((name: string) => {
    setDisplayName(name);
  }, []);

  return (
    <div className="space-y-6">
      {/* Persistent Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/partners" className="text-muted-foreground hover:text-foreground">
            &larr; {t("partners.title")}
          </Link>
          <h1 className="text-2xl font-semibold">{displayName}</h1>
          <Badge variant={isActive ? "default" : "secondary"}>
            {isActive ? t("partners.status.active") : t("partners.status.inactive")}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <GraphLink self={{ type: "partner", id: partner.id }} />
          {isActive ? (
            <Button variant="destructive" size="sm" onClick={handleDeactivate}>
              {t("partners.deactivate")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleReactivate}>
              {t("partners.reactivate")}
            </Button>
          )}
        </div>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="overview">
        <TabsList variant="line">
          <TabsTrigger value="overview">{t("partners.tab.overview")}</TabsTrigger>
          <TabsTrigger value="contracts">
            {t("partners.tab.contracts", { count: contracts.length })}
          </TabsTrigger>
          <TabsTrigger value="transactions">
            {t("partners.tab.transactionsCount", { count: journal.total })}
          </TabsTrigger>
          <TabsTrigger value="documents">
            {t("partners.tab.documentsCount", { count: documents.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          {/* Relationship Summary */}
          <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("partners.col.types")}</dt>
              <dd className="font-medium">
                {partner.types
                  .map((type) => t(`partners.type.${type as "client" | "vendor" | "employee"}`))
                  .join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("partners.overview.activeContracts")}</dt>
              <dd className="font-medium">{activeContractCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("partners.overview.totalContracts")}</dt>
              <dd className="font-medium">{contracts.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("partners.tab.transactions")}</dt>
              <dd className="font-medium">{journal.total}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("partners.tab.documents")}</dt>
              <dd className="font-medium">{documents.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("partners.col.created")}</dt>
              <dd className="font-medium">
                {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                  new Date(partner.createdAt),
                )}
              </dd>
            </div>
          </dl>
          <PartnerForm
            hideHeader
            partner={partner}
            basOptions={basOptions}
            onNameSaved={handleNameSaved}
          />
        </TabsContent>

        <TabsContent value="contracts" className="pt-4">
          {isClient ? (
            <ContractList
              partnerId={partner.id}
              contracts={contracts}
              vatRegistrations={vatRegistrations}
              employeePartners={employeePartners}
              defaultCurrency={defaultCurrency}
            />
          ) : (
            <Card>
              <CardContent className="py-8">
                <p className="text-muted-foreground">{t("partners.contracts.notClient")}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="transactions" className="pt-4">
          {journal.rows.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <p className="text-muted-foreground">{t("partners.transactions.empty")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2" data-testid="partner-transactions">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("partners.transactions.showing", {
                    shown: journal.rows.length,
                    total: journal.total,
                  })}
                </span>
                <Link
                  href={`/journal?f.partnerId=in:${partner.id}`}
                  className="text-xs hover:underline"
                >
                  {t("partners.transactions.openJournal")}
                </Link>
              </div>
              <ul className="divide-y rounded-md border text-sm">
                {journal.rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 text-muted-foreground tabular-nums">{r.entryDate}</span>
                      <span title={r.description}>{r.description}</span>
                      {r.basLabel && (
                        <span className="ml-2 text-xs text-muted-foreground">{r.basLabel}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      {formatCurrency(r.amount, r.currency as Currency)} {r.currency}
                      {r.currency !== "SEK" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatCurrency(r.amountBase, "SEK")} SEK
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          {documents.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <p className="text-muted-foreground">{t("partners.documents.empty")}</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-md border text-sm" data-testid="partner-documents">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">
                    <Link href={`/documents/${d.id}`} className="font-medium hover:underline">
                      {d.businessKey}
                    </Link>
                    <span className="ml-2 text-muted-foreground">{d.fileName}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {d.documentType} · {d.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
