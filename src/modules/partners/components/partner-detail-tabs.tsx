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
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import { ContractList } from "@/modules/contracts/ui";
import { type PartnerData, PartnerForm } from "@/modules/partners/components/partner-form";
import {
  deactivatePartnerAction,
  reactivatePartnerAction,
} from "@/modules/partners/partners.actions";

type BasOption = { code: string; label: string };
type VatOption = { id: string; label: string };
type EmployeeOption = { id: string; name: string };

type ContractRow = {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  assignedEmployeeId: string | null;
  billingRate: string | null;
  currency: string | null;
  paymentTerms: string | null;
  vatRegistrationId: string | null;
  externalReferences: { label: string; value: string }[];
  isActive: boolean;
};

interface PartnerDetailTabsProps {
  partner: PartnerData;
  contracts: ContractRow[];
  vatRegistrations: VatOption[];
  employeePartners: EmployeeOption[];
  basOptions: BasOption[];
  defaultCurrency: string | null;
}

export function PartnerDetailTabs({
  partner,
  contracts,
  vatRegistrations,
  employeePartners,
  basOptions,
  defaultCurrency,
}: PartnerDetailTabsProps) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(partner.isActive);
  const [displayName, setDisplayName] = useState(partner.name);
  const { executeAsync: execDeactivate } = useAction(deactivatePartnerAction);
  const { executeAsync: execReactivate } = useAction(reactivatePartnerAction);

  const { dialogProps, confirm } = useConfirmDialog({
    title: "Deactivate Partner",
    variant: "destructive",
    confirmLabel: "Deactivate",
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
        toast.success("Partner deactivated");
        router.refresh();
      },
      {
        description: `Deactivate "${displayName}"? The partner will be hidden from active lists but retained for historical references.`,
      },
    );
  }, [confirm, execDeactivate, partner.id, displayName, router]);

  const handleReactivate = useCallback(async () => {
    const result = await execReactivate({ id: partner.id });
    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }
    setIsActive(true);
    toast.success("Partner reactivated");
    router.refresh();
  }, [execReactivate, partner.id, router]);

  const handleNameSaved = useCallback((name: string) => {
    setDisplayName(name);
  }, []);

  return (
    <div className="space-y-6">
      {/* Persistent Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/partners" className="text-muted-foreground hover:text-foreground">
            &larr; Partners
          </Link>
          <h1 className="text-2xl font-semibold">{displayName}</h1>
          <Badge variant={isActive ? "default" : "secondary"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
        {isActive ? (
          <Button variant="destructive" size="sm" onClick={handleDeactivate}>
            Deactivate
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handleReactivate}>
            Reactivate
          </Button>
        )}
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="overview">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contracts">Contracts ({contracts.length})</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          {/* Relationship Summary */}
          <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Types</dt>
              <dd className="font-medium">{partner.types.join(", ")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Active Contracts</dt>
              <dd className="font-medium">{activeContractCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total Contracts</dt>
              <dd className="font-medium">{contracts.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Transactions</dt>
              <dd className="font-medium">0</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Documents</dt>
              <dd className="font-medium">0</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
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
                <p className="text-muted-foreground">
                  This partner is not a client — contracts are only available for client-type
                  partners. You can add the &ldquo;client&rdquo; type in the Overview tab.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="transactions" className="pt-4">
          <Card>
            <CardContent className="py-8">
              <p className="text-muted-foreground">
                No transactions linked to this partner yet. Transactions will appear here
                automatically when bank statement imports are processed and journal entries
                reference this partner.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <Card>
            <CardContent className="py-8">
              <p className="text-muted-foreground">
                No documents linked to this partner yet. Documents will appear here when uploaded
                files are associated with this partner.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
