"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Filter, ListQuery } from "@/kernel/list-query/types";
import { TEXT_OP_LABELS } from "./filters/text-filter";
import type { DataTableColumn } from "./types";

export function describeFilter(f: Filter, label?: (v: string | null) => string): string {
  const show = (v: string | null) => (v === null ? "(Blanks)" : (label?.(v) ?? v));
  switch (f.kind) {
    case "in": {
      const names = f.values.map(show);
      return names.length > 3
        ? `${names.slice(0, 3).join(", ")} +${names.length - 3}`
        : names.join(", ");
    }
    case "text":
      return f.value === undefined
        ? TEXT_OP_LABELS[f.op].toLowerCase()
        : `${TEXT_OP_LABELS[f.op].toLowerCase()} "${f.value}"`;
    case "range":
      if (f.empty) return "is empty";
      if (f.min !== undefined && f.max !== undefined)
        return f.min === f.max ? `= ${f.min}` : `${f.min} – ${f.max}`;
      return f.min !== undefined ? `≥ ${f.min}` : `≤ ${f.max}`;
    case "dates": {
      if (f.empty) return "is empty";
      const parts: string[] = [];
      const tokens = [...(f.years ?? []).map(String), ...(f.months ?? []), ...(f.days ?? [])];
      if (tokens.length)
        parts.push(
          tokens.length > 3
            ? `${tokens.slice(0, 3).join(", ")} +${tokens.length - 3}`
            : tokens.join(", "),
        );
      if (f.from && f.to) parts.push(`${f.from} → ${f.to}`);
      else if (f.from) parts.push(`from ${f.from}`);
      else if (f.to) parts.push(`to ${f.to}`);
      return parts.join(" · ");
    }
  }
}

export interface FilterChipsProps<Row> {
  query: ListQuery;
  columns: DataTableColumn<Row>[];
  valueLabel?: (column: string, value: string | null) => string;
  onRemove: (column: string) => void;
  onClearAll: () => void;
  onClearSearch: () => void;
}

export function FilterChips<Row>({
  query,
  columns,
  valueLabel,
  onRemove,
  onClearAll,
  onClearSearch,
}: FilterChipsProps<Row>) {
  const entries = Object.entries(query.filters);
  if (entries.length === 0 && !query.search) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {query.search && <Chip label="Search" value={`"${query.search}"`} onRemove={onClearSearch} />}
      {entries.map(([col, f]) => {
        const column = columns.find((c) => c.key === col);
        return (
          <Chip
            key={col}
            label={column?.header ?? col}
            value={describeFilter(f, valueLabel ? (v) => valueLabel(col, v) : undefined)}
            onRemove={() => onRemove(col)}
          />
        );
      })}
      {(entries.length > 1 || (entries.length === 1 && query.search)) && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}

function Chip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-xs items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5">
      <span className="font-medium">{label}</span>
      <span className="truncate text-muted-foreground">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded text-muted-foreground hover:text-foreground"
        aria-label={`Remove filter on ${label}`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
