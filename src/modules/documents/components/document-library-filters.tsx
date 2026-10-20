"use client";

import { Filter, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentFilters } from "@/modules/documents/documents.actions";

// MUST NOT import from module services (server code)

interface FilterOptions {
  statuses: string[];
  documentTypes: string[];
  prefixTypes: string[];
}

interface DocumentLibraryFiltersProps {
  filters: DocumentFilters;
  filterOptions: FilterOptions;
  onFilterChange: (filters: Partial<DocumentFilters>) => void;
  onClearAll: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  extracted: "Extracted",
  ocr_failed: "OCR Failed",
  linked: "Linked",
};

const TYPE_LABELS: Record<string, string> = {
  financial: "Financial",
  relationship: "Relationship",
  expense: "Expense",
  invoice: "Invoice",
  contract: "Contract",
  nda: "NDA",
  certificate: "Certificate",
};

function MultiSelectDropdown({
  label,
  options,
  selected,
  getLabel,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[] | undefined;
  getLabel: (v: string) => string;
  onChange: (selected: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(selected ?? []);
  const activeCount = selectedSet.size;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(Array.from(next));
  }

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => setOpen((o) => !o)}
      >
        <Filter className="h-3.5 w-3.5" />
        {label}
        {activeCount > 0 && (
          <Badge variant="secondary" className="h-4 px-1 text-xs">
            {activeCount}
          </Badge>
        )}
      </Button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[160px] rounded-md border bg-popover shadow-md">
          <div className="py-1">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>
            ) : (
              options.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option)}
                    onChange={() => toggle(option)}
                    className="rounded"
                  />
                  {getLabel(option)}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DocumentLibraryFilters({
  filters,
  filterOptions,
  onFilterChange,
  onClearAll,
}: DocumentLibraryFiltersProps) {
  const [searchValue, setSearchValue] = useState(filters.search ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasActiveFilters =
    (filters.status?.length ?? 0) > 0 ||
    (filters.documentType?.length ?? 0) > 0 ||
    (filters.prefixType?.length ?? 0) > 0 ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    !!filters.search;

  const handleSearch = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange({ search: value || undefined });
      }, 300);
    },
    [onFilterChange],
  );

  // Sync search value when filters reset externally
  useEffect(() => {
    setSearchValue(filters.search ?? "");
  }, [filters.search]);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="document-filters">
      {/* Search input */}
      <Input
        type="search"
        placeholder="Search documents..."
        value={searchValue}
        onChange={(e) => handleSearch(e.target.value)}
        className="h-8 w-56 text-sm"
      />

      {/* Status multi-select */}
      <MultiSelectDropdown
        label="Status"
        options={filterOptions.statuses}
        selected={filters.status}
        getLabel={(v) => STATUS_LABELS[v] ?? v}
        onChange={(selected) => onFilterChange({ status: selected.length ? selected : undefined })}
      />

      {/* Document type multi-select */}
      {filterOptions.prefixTypes.length > 0 && (
        <MultiSelectDropdown
          label="Type"
          options={filterOptions.prefixTypes}
          selected={filters.prefixType}
          getLabel={(v) => TYPE_LABELS[v] ?? v}
          onChange={(selected) =>
            onFilterChange({ prefixType: selected.length ? selected : undefined })
          }
        />
      )}

      {/* Period filter */}
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={(e) => onFilterChange({ dateFrom: e.target.value || undefined })}
          className="h-8 w-36 text-sm"
          aria-label="From date"
        />
        <span className="text-muted-foreground text-sm">–</span>
        <Input
          type="date"
          value={filters.dateTo ?? ""}
          onChange={(e) => onFilterChange({ dateTo: e.target.value || undefined })}
          className="h-8 w-36 text-sm"
          aria-label="To date"
        />
      </div>

      {/* Clear all */}
      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-muted-foreground"
          onClick={onClearAll}
        >
          <X className="h-3.5 w-3.5" />
          Clear all
        </Button>
      )}
    </div>
  );
}
