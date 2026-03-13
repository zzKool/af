"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import {
  createPartnerAction,
  deactivatePartnerAction,
  reactivatePartnerAction,
} from "@/server/actions/partners";

type PartnerRow = {
  id: string;
  name: string;
  types: string[];
  orgNumber: string | null;
  defaultCurrency: string | null;
  isActive: boolean;
};

type BasOption = { code: string; label: string };

const TYPE_COLORS: Record<string, string> = {
  client: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  vendor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  employee: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

function TypeBadges({ types }: { types: string[] }) {
  return (
    <div className="flex gap-1">
      {types.map((t) => (
        <Badge key={t} variant="outline" className={TYPE_COLORS[t] ?? ""}>
          {t}
        </Badge>
      ))}
    </div>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>
  );
}

interface PartnerListProps {
  initialPartners: PartnerRow[];
  basOptions: BasOption[];
}

export function PartnerList({ initialPartners, basOptions: _basOptions }: PartnerListProps) {
  const [partners, setPartners] = useState<PartnerRow[]>(initialPartners);
  const [showInactive, setShowInactive] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTypes, setNewTypes] = useState<string[]>(["client"]);

  const { dialogProps, confirm } = useConfirmDialog({
    title: "Deactivate Partner",
    variant: "destructive",
    confirmLabel: "Deactivate",
  });

  const { executeAsync: execCreate, isPending: isCreating } = useAction(createPartnerAction);
  const { executeAsync: execDeactivate } = useAction(deactivatePartnerAction);
  const { executeAsync: execReactivate } = useAction(reactivatePartnerAction);

  const filteredPartners = useMemo(() => {
    let result = partners;
    if (!showInactive) {
      result = result.filter((p) => p.isActive);
    }
    if (search) {
      const term = search.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(term) || p.orgNumber?.toLowerCase().includes(term),
      );
    }
    return result;
  }, [partners, showInactive, search]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || newTypes.length === 0) return;
    const result = await execCreate({
      name: newName.trim(),
      types: newTypes as ("client" | "vendor" | "employee")[],
    });
    if (result?.serverError) {
      toast.error(result.serverError.message ?? "Failed to create partner");
      return;
    }
    if (result?.data?.error) {
      toast.error(result.data.error.message);
      return;
    }
    toast.success("Partner created");
    setNewName("");
    setNewTypes(["client"]);
    setShowCreateForm(false);
    // Add to list optimistically
    const newId = result?.data?.data?.id;
    if (newId) {
      setPartners((prev) => [
        ...prev,
        {
          id: newId,
          name: newName.trim(),
          types: newTypes,
          orgNumber: null,
          defaultCurrency: null,
          isActive: true,
        },
      ]);
    }
  }, [newName, newTypes, execCreate]);

  const handleDeactivate = useCallback(
    (partner: PartnerRow) => {
      confirm(
        async () => {
          const result = await execDeactivate({ id: partner.id });
          if (result?.serverError) {
            throw new Error(result.serverError.message ?? "Failed to deactivate");
          }
          toast.success(`${partner.name} deactivated`);
          setPartners((prev) =>
            prev.map((p) => (p.id === partner.id ? { ...p, isActive: false } : p)),
          );
        },
        {
          description: `Deactivate "${partner.name}"? The partner will be hidden from active lists but retained for historical references.`,
        },
      );
    },
    [confirm, execDeactivate],
  );

  const handleReactivate = useCallback(
    async (partner: PartnerRow) => {
      const result = await execReactivate({ id: partner.id });
      if (result?.serverError) {
        toast.error(result.serverError.message ?? "Failed to reactivate");
        return;
      }
      toast.success(`${partner.name} reactivated`);
      setPartners((prev) => prev.map((p) => (p.id === partner.id ? { ...p, isActive: true } : p)));
    },
    [execReactivate],
  );

  const columns: ColumnDef<PartnerRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link
            href={`/partners/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "types",
        header: "Types",
        cell: ({ row }) => <TypeBadges types={row.original.types} />,
      },
      {
        accessorKey: "orgNumber",
        header: "Org Number",
        cell: ({ row }) => row.original.orgNumber ?? "—",
      },
      {
        accessorKey: "defaultCurrency",
        header: "Currency",
        cell: ({ row }) => row.original.defaultCurrency ?? "—",
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) => <StatusBadge isActive={row.original.isActive} />,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const partner = row.original;
          return partner.isActive ? (
            <Button variant="ghost" size="sm" onClick={() => handleDeactivate(partner)}>
              Deactivate
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => handleReactivate(partner)}>
              Reactivate
            </Button>
          );
        },
      },
    ],
    [handleDeactivate, handleReactivate],
  );

  const table = useReactTable({
    data: filteredPartners,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search partners..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <div className="flex-1" />
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? "Cancel" : "Add Partner"}
        </Button>
      </div>

      {/* Inline create form */}
      {showCreateForm && (
        <div className="flex items-end gap-3 rounded-lg border p-4">
          <div className="flex-1">
            <label htmlFor="new-partner-name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <Input
              id="new-partner-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Partner name"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium">Types</span>
            <div className="flex gap-2">
              {["client", "vendor", "employee"].map((type) => (
                <label key={type} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={newTypes.includes(type)}
                    onChange={(e) => {
                      setNewTypes((prev) =>
                        e.target.checked ? [...prev, type] : prev.filter((t) => t !== type),
                      );
                    }}
                  />
                  {type}
                </label>
              ))}
            </div>
          </div>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !newName.trim() || newTypes.length === 0}
          >
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </div>
      )}

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
                  {search
                    ? "No partners match your search."
                    : "No partners yet. Add your first partner above."}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
