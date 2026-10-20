"use client";

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useAction } from "next-safe-action/hooks";
import { Fragment, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { CURRENCIES, PAYMENT_TERMS } from "@/kernel/nav/constants";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  createContractAction,
  deactivateContractAction,
  reactivateContractAction,
  updateContractAction,
} from "@/modules/contracts/contracts.actions";

type ExternalReference = { label: string; value: string };

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
  externalReferences: ExternalReference[];
  isActive: boolean;
};

interface ContractListProps {
  partnerId: string;
  contracts: ContractRow[];
  vatRegistrations: VatOption[];
  employeePartners: EmployeeOption[];
  defaultCurrency: string | null;
}

// ─────────────────────────────────────────────────────────────
// Inline Edit Form (expanded below a contract row)
// ─────────────────────────────────────────────────────────────
function ContractEditForm({
  contract,
  vatRegistrations,
  employeePartners,
  onAutoSave,
  onDeactivate,
  onReactivate,
}: {
  contract: ContractRow;
  vatRegistrations: VatOption[];
  employeePartners: EmployeeOption[];
  onAutoSave: (id: string, field: string, value: unknown) => Promise<boolean>;
  onDeactivate: (contract: ContractRow) => void;
  onReactivate: (contract: ContractRow) => void;
}) {
  const [name, setName] = useState(contract.name);
  const [startDate, setStartDate] = useState(contract.startDate);
  const [endDate, setEndDate] = useState(contract.endDate ?? "");
  const [billingRate, setBillingRate] = useState(contract.billingRate ?? "");
  const [currency, setCurrency] = useState(contract.currency ?? "");
  const [paymentTerms, setPaymentTerms] = useState(contract.paymentTerms ?? "");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(contract.assignedEmployeeId ?? "");
  const [vatRegistrationId, setVatRegistrationId] = useState(contract.vatRegistrationId ?? "");
  const [externalRefs, setExternalRefs] = useState<ExternalReference[]>(
    contract.externalReferences ?? [],
  );

  const handleBlur = useCallback(
    (field: string, currentValue: string, originalValue: string | null) => {
      if (currentValue === (originalValue ?? "")) return;
      // Empty string → undefined for optional fields so Zod's .optional() accepts the clear
      onAutoSave(contract.id, field, currentValue || undefined);
    },
    [contract.id, onAutoSave],
  );

  const handleSelectChange = useCallback(
    (field: string, value: string | null, setter: (v: string) => void) => {
      const cleared = !value || value === "__none__" ? "" : value;
      setter(cleared);
      onAutoSave(contract.id, field, cleared || undefined);
    },
    [contract.id, onAutoSave],
  );

  const handleRefsSave = useCallback(() => {
    const valid = externalRefs.filter((r) => r.label.trim() && r.value.trim());
    setExternalRefs(valid);
    onAutoSave(contract.id, "externalReferences", valid);
  }, [externalRefs, contract.id, onAutoSave]);

  return (
    <div className="space-y-4 border-l-2 border-primary/20 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => handleBlur("name", name, contract.name)}
          />
        </div>
        <div>
          <Label>Start Date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            onBlur={() => handleBlur("startDate", startDate, contract.startDate)}
          />
        </div>
        <div>
          <Label>End Date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            onBlur={() => handleBlur("endDate", endDate, contract.endDate)}
          />
        </div>
        <div>
          <Label>Billing Rate</Label>
          <Input
            type="text"
            value={billingRate}
            onChange={(e) => setBillingRate(e.target.value)}
            onBlur={() => handleBlur("billingRate", billingRate, contract.billingRate)}
            placeholder="e.g., 1500.00 per day"
          />
        </div>
        <div>
          <Label>Currency</Label>
          <Select
            value={currency || "__none__"}
            onValueChange={(v) => handleSelectChange("currency", v, setCurrency)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Payment Terms</Label>
          <Select
            value={paymentTerms || "__none__"}
            onValueChange={(v) => handleSelectChange("paymentTerms", v, setPaymentTerms)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select payment terms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {PAYMENT_TERMS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Assigned Employee</Label>
          <Select
            value={assignedEmployeeId || "__none__"}
            onValueChange={(v) =>
              handleSelectChange("assignedEmployeeId", v, setAssignedEmployeeId)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {employeePartners.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No employees added yet
                </SelectItem>
              ) : (
                employeePartners.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>VAT Registration</Label>
          <Select
            value={vatRegistrationId || "__none__"}
            onValueChange={(v) => handleSelectChange("vatRegistrationId", v, setVatRegistrationId)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select VAT registration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {vatRegistrations.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No VAT registrations configured
                </SelectItem>
              ) : (
                vatRegistrations.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* External References */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>External References</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (externalRefs.length >= 5) {
                toast.error("Maximum 5 external references");
                return;
              }
              setExternalRefs([...externalRefs, { label: "", value: "" }]);
            }}
          >
            Add Reference
          </Button>
        </div>
        {externalRefs.length === 0 && (
          <p className="text-sm text-muted-foreground">No external references.</p>
        )}
        {externalRefs.map((ref, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dynamic list without stable IDs
          <div key={i} className="mb-2 flex items-end gap-2">
            <div className="flex-1">
              <Input
                value={ref.label}
                onChange={(e) => {
                  const updated = [...externalRefs];
                  updated[i] = { ...updated[i], label: e.target.value };
                  setExternalRefs(updated);
                }}
                placeholder="Label"
              />
            </div>
            <div className="flex-1">
              <Input
                value={ref.value}
                onChange={(e) => {
                  const updated = [...externalRefs];
                  updated[i] = { ...updated[i], value: e.target.value };
                  setExternalRefs(updated);
                }}
                placeholder="Value"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const updated = externalRefs.filter((_, idx) => idx !== i);
                setExternalRefs(updated);
                onAutoSave(contract.id, "externalReferences", updated);
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        {externalRefs.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleRefsSave}>
            Save References
          </Button>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {contract.isActive ? (
          <Button variant="destructive" size="sm" onClick={() => onDeactivate(contract)}>
            Deactivate
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => onReactivate(contract)}>
            Reactivate
          </Button>
        )}
      </div>
    </div>
  );
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
    title: "Deactivate Contract",
    variant: "destructive",
    confirmLabel: "Deactivate",
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
      currency: (defaultCurrency as "SEK" | "CHF" | "EUR" | "USD") || undefined,
    });
    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Contract created");
    const newId = result?.data?.data?.id;
    if (newId) {
      setContracts((prev) => [
        {
          id: newId,
          name: newName.trim(),
          startDate: newStartDate,
          endDate: null,
          assignedEmployeeId: null,
          billingRate: null,
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
  }, [newName, newStartDate, partnerId, defaultCurrency, execCreate]);

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

  const handleDeactivate = useCallback(
    (contract: ContractRow) => {
      confirm(
        async () => {
          const result = await execDeactivate({ id: contract.id });
          const error = extractError(result);
          if (error) throw new Error(error);
          toast.success("Contract deactivated");
          setContracts((prev) =>
            prev.map((c) => (c.id === contract.id ? { ...c, isActive: false } : c)),
          );
        },
        {
          description: `Deactivate "${contract.name}"? The contract will be hidden from active lists.`,
        },
      );
    },
    [confirm, execDeactivate],
  );

  const handleReactivate = useCallback(
    async (contract: ContractRow) => {
      const result = await execReactivate({ id: contract.id });
      const error = extractError(result);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success("Contract reactivated");
      setContracts((prev) =>
        prev.map((c) => (c.id === contract.id ? { ...c, isActive: true } : c)),
      );
    },
    [execReactivate],
  );

  const columns: ColumnDef<ContractRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "dateRange",
        header: "Date Range",
        cell: ({ row }) => {
          const start = row.original.startDate;
          const end = row.original.endDate;
          return end ? `${start} — ${end}` : `${start} — ongoing`;
        },
      },
      {
        id: "billingRate",
        header: "Billing Rate",
        cell: ({ row }) => {
          const rate = row.original.billingRate;
          const curr = row.original.currency;
          if (!rate) return "—";
          return `${Number(rate).toFixed(2)} ${curr ?? ""}`.trim();
        },
      },
      {
        accessorKey: "paymentTerms",
        header: "Payment Terms",
        cell: ({ row }) => row.original.paymentTerms ?? "—",
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "default" : "secondary"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      },
    ],
    [],
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
          <CardTitle>Contracts ({activeCount})</CardTitle>
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
            {showCreateForm ? "Cancel" : "+ New Contract"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inline create form */}
        {showCreateForm && (
          <div className="flex items-end gap-3 rounded-lg border p-4">
            <div className="flex-1">
              <Label htmlFor="new-contract-name">Name</Label>
              <Input
                id="new-contract-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Contract name"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div>
              <Label htmlFor="new-contract-start">Start Date</Label>
              <Input
                id="new-contract-start"
                type="date"
                value={newStartDate}
                onChange={(e) => setNewStartDate(e.target.value)}
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !newName.trim() || !newStartDate}
            >
              {isCreating ? "Creating..." : "Create"}
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
            Show inactive
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
                    No contracts yet. Create your first contract above.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
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
                            onDeactivate={handleDeactivate}
                            onReactivate={handleReactivate}
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
