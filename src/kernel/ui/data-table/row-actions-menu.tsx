"use client";

// A row's ⋮ menu (D40) — the DataTable's last cell, and the same menu for the few kit `Table`s that are not
// DataTables (an inline-edit grid such as a contract's rates). Destructive entries go through a ConfirmDialog.
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RowAction } from "./types";

export function RowActionsMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
        aria-label={label}
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.label}
            disabled={a.disabled}
            variant={a.destructive ? "destructive" : "default"}
            onClick={a.onClick}
          >
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
