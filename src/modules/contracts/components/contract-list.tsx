"use client";

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useAction } from "next-safe-action/hooks";
import { Fragment, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
// The Contracts tab of the partner page: the contracts as a kit Table (a handful of rows — no DataTable, no URL
// state), the derived state as <StateLabel> through state-family.ts, the currency as a <Tag>, the current rate
// through formatMoney, Deactivate / Reactivate in the row's ⋮ menu (F71, D40). A row click expands the
// contract's form and its Rates section.
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import type { Currency } from "@/kernel/nav/constants";
import { RowActionsMenu } from "@/kernel/ui/data-table";
import { StateLabel } from "@/kernel/ui/state-label";
import { Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  createContractAction,
  deactivateContractAction,
  reactivateContractAction,
  updateContractAction,
} from "@/modules/contracts/contracts.actions";
import { contractState, contractStateFamily } from "@/modules/contracts/state-family";
import {
  ContractEditForm,
  type ContractRow,
  type EmployeeOption,
  type VatOption,
} from "./contract-edit-form";
import type { ContractRateRow } from "./contract-rates";

export type { ContractRow } from "./contract-edit-form";

interface ContractListProps {
  partnerId: string;
  contracts: ContractRow[];
  vatRegistrations: VatOption[];
  employeePartners: EmployeeOption[];
  defaultCurrency: string | null;
}

// ─────────────────────────────────────────────────────────────
// Main ContractList component
// ─────────────────────────────────────────────────────────────
export function ContractList({
  partnerId,
  contracts: initialContracts,
  vatRegistrations,
  employeePartners,
  defaultCurrency,
}: ContractListProps) {
  const t = useT();
  const [contracts, setContracts] = useState<ContractRow[]>(initialContracts);
  const [showInactive, setShowInactive] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newStartDate, setNewStartDate] = useState("");

  const { executeAsync: execCreate, isPending: isCreating } = useAction(createContractAction);
  const { executeAsync: execUpdate } = useAction(updateContractAction);
  const { executeAsync: execDeactivate } = useAction(deactivateContractAction);
  const { executeAsync: execReactivate } = useAction(reactivateContractAction);

  const { dialogProps, confirm } = useConfirmDialog({
    title: t("contracts.deactivateConfirm.title"),
    variant: "destructive",
    confirmLabel: t("partners.deactivate"),
  });

  const filteredContracts = useMemo(() => {
    if (showInactive) return contracts;
    return contracts.filter((c) => c.isActive);
  }, [contracts, showInactive]);

  const activeCount = useMemo(() => contracts.filter((c) => c.isActive).length, [contracts]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || !newStartDate) return;
    const result = await execCreate({
      partnerId,
      name: newName.trim(),
      startDate: newStartDate,
      currency: (defaultCurrency as Currency) || undefined,
    });
    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("contracts.created"));
    const newId = result?.data?.data?.id;
    if (newId) {
      setContracts((prev) => [
        {
          id: newId,
          name: newName.trim(),
          startDate: newStartDate,
          endDate: null,
          assignedEmployeeId: null,
          currentRate: null,
          rates: [],
          currency: defaultCurrency,
          paymentTerms: null,
          vatRegistrationId: null,
          externalReferences: [],
          isActive: true,
        },
        ...prev,
      ]);
    }
    setNewName("");
    setNewStartDate("");
    setShowCreateForm(false);
  }, [newName, newStartDate, partnerId, defaultCurrency, execCreate, t]);

  const handleAutoSave = useCallback(
    async (id: string, field: string, value: unknown) => {
      const result = await execUpdate({ id, [field]: value });
      const error = extractError(result);
      if (error) {
        toast.error(error);
        return false;
      }
      // Update local state
      setContracts((prev) =>
        prev.map((c) => (c.id === id ? { ...c, [field]: value === "" ? null : value } : c)),
      );
      return true;
    },
    [execUpdate],
  );

  const handleRatesChange = useCallback((contractId: string, rates: ContractRateRow[]) => {
    const current = rates.find((r) => r.state === "current");
    setContracts((prev) =>
      prev.map((c) =>
        c.id === contractId
          ? {
              ...c,
              rates,
              currentRate: current
                ? { id: current.id, rate: current.rate, unit: current.unit }
                : null,
            }
          : c,
      ),
    );
  }, []);

  const handleDeactivate = useCallback(
    (contract: ContractRow) => {
      confirm(
        async () => {
          const result = await execDeactivate({ id: contract.id });
          const error = extractError(result);
          if (error) throw new Error(error);
          toast.success(t("contracts.deactivated"));
          setContracts((prev) =>
            prev.map((c) => (c.id === contract.id ? { ...c, isActive: false } : c)),
          );
        },
        {
          description: t("contracts.deactivateConfirm.description", { name: contract.name }),
        },
      );
    },
    [confirm, execDeactivate, t],
  );

  const handleReactivate = useCallback(
    async (contract: ContractRow) => {
      const result = await execReactivate({ id: contract.id });
      const error = extractError(result);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(t("contracts.reactivated"));
      setContracts((prev) =>
        prev.map((c) => (c.id === contract.id ? { ...c, isActive: true } : c)),
      );
    },
    [execReactivate, t],
  );

  const columns: ColumnDef<ContractRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("contracts.form.name"),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "dateRange",
        header: t("contracts.col.dateRange"),
        cell: ({ row }) => {
          const start = row.original.startDate;
          const end = row.original.endDate;
          return end ? `${start} — ${end}` : `${start} — ${t("contracts.col.ongoing")}`;
        },
      },
      {
        id: "currentRate",
        header: () => <span className="block text-right">{t("contracts.currentRate")}</span>,
        cell: ({ row }) => {
          const rate = row.original.currentRate;
          if (!rate) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="block text-right tabular-nums" data-amount={rate.rate}>
              {formatMoney(rate.rate, row.original.currency)}
            </span>
          );
        },
      },
      {
        accessorKey: "currency",
        header: t("contracts.form.currency"),
        cell: ({ row }) =>
          row.original.currency ? (
            <Tag>{row.original.currency}</Tag>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "paymentTerms",
        header: t("contracts.form.paymentTerms"),
        cell: ({ row }) =>
          row.original.paymentTerms ?? <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "isActive",
        header: t("partners.col.status"),
        cell: ({ row }) => {
          const state = contractState(row.original.isActive);
          return (
            <StateLabel family={contractStateFamily(state)} state={t(`partners.status.${state}`)} />
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          // the ⋮ menu's clicks (its items portal, but React events bubble through the tree) never toggle the row
          // biome-ignore lint/a11y/noStaticElementInteractions: only stops propagation; the menu is the control
          // biome-ignore lint/a11y/useKeyWithClickEvents: same — the trigger is a real button
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RowActionsMenu
              label={t("table.rowActions")}
              actions={
                row.original.isActive
                  ? [
                      {
                        label: t("partners.deactivate"),
                        destructive: true,
                        onClick: () => handleDeactivate(row.original),
                      },
                    ]
                  : [
                      {
                        label: t("partners.reactivate"),
                        onClick: () => void handleReactivate(row.original),
                      },
                    ]
              }
            />
          </div>
        ),
      },
    ],
    [t, handleDeactivate, handleReactivate],
  );

  const table = useReactTable({
    data: filteredContracts,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("partners.tab.contracts", { count: activeCount })}</CardTitle>
          <Button
            size="sm"
            onClick={() => {
              setShowCreateForm(!showCreateForm);
              if (showCreateForm) {
                setNewName("");
                setNewStartDate("");
              }
            }}
          >
            {showCreateForm ? t("common.cancel") : t("contracts.new")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inline create form */}
        {showCreateForm && (
          <div className="flex items-end gap-3 rounded-lg border p-4">
            <div className="flex-1">
              <Label htmlFor="new-contract-name">{t("contracts.form.name")}</Label>
              <Input
                id="new-contract-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("contracts.form.namePlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div>
              <Label htmlFor="new-contract-start">{t("contracts.form.startDate")}</Label>
              <DateInput
                id="new-contract-start"
                value={newStartDate}
                onChange={(e) => setNewStartDate(e.target.value)}
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !newName.trim() || !newStartDate}
            >
              {isCreating ? t("partners.new.creating") : t("partners.new.create")}
            </Button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t("contracts.showInactive")}
          </label>
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    {t("contracts.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-hover"
                      onClick={() =>
                        setExpandedId(expandedId === row.original.id ? null : row.original.id)
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {expandedId === row.original.id && (
                      <TableRow>
                        <TableCell colSpan={columns.length} className="p-0">
                          <ContractEditForm
                            contract={row.original}
                            vatRegistrations={vatRegistrations}
                            employeePartners={employeePartners}
                            onAutoSave={handleAutoSave}
                            onRatesChange={handleRatesChange}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <ConfirmDialog {...dialogProps} />
    </Card>
  );
}
