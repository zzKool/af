"use client";

// Excel-style value list: distinct values with counts over the set filtered by the OTHER columns,
// search to narrow, select all / clear, blanks as "(Blanks)". Applies on OK, not on every click.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { DistinctValue, Filter } from "@/kernel/list-query/types";
import { DISTINCT_CAP } from "@/kernel/list-query/types";

const BLANK_KEY = "\u0000blank";
const toKey = (v: string | null) => (v === null ? BLANK_KEY : v);
const fromKey = (k: string) => (k === BLANK_KEY ? null : k);

export interface CheckboxFilterProps {
  current: Filter | null;
  load: () => Promise<DistinctValue[]>;
  /** Shown instead of the raw value (e.g. "true" → "Active"). */
  label?: (value: string | null) => string;
  onApply: (filter: Filter | null) => void;
  onClose: () => void;
}

export function CheckboxFilter({ current, load, label, onApply, onClose }: CheckboxFilterProps) {
  const [values, setValues] = useState<DistinctValue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const initial = useMemo(
    () => new Set(current?.kind === "in" ? current.values.map(toKey) : []),
    [current],
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  // No filter yet = everything selected (Excel): we model that as "all" until the user unticks.
  const [all, setAll] = useState(current === null || current.kind !== "in");

  useEffect(() => {
    let active = true;
    load()
      .then((v) => active && setValues(v))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      active = false;
    };
  }, [load]);

  const visible = useMemo(() => {
    if (!values) return [];
    const term = search.trim().toLowerCase();
    if (!term) return values;
    return values.filter((v) => (label?.(v.value) ?? v.value ?? "").toLowerCase().includes(term));
  }, [values, search, label]);

  const isChecked = (v: string | null) => all || selected.has(toKey(v));

  function toggle(v: string | null) {
    const key = toKey(v);
    const next = new Set(all ? (values ?? []).map((x) => toKey(x.value)) : selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setAll(false);
    setSelected(next);
  }

  function selectVisible(on: boolean) {
    const next = new Set(all ? (values ?? []).map((x) => toKey(x.value)) : selected);
    for (const v of visible) {
      if (on) next.add(toKey(v.value));
      else next.delete(toKey(v.value));
    }
    setAll(false);
    setSelected(next);
  }

  function apply() {
    if (all || (values && selected.size === values.length && !search)) onApply(null);
    else onApply({ kind: "in", values: [...selected].map(fromKey) });
    onClose();
  }

  const display = (v: string | null) => (v === null ? "(Blanks)" : (label?.(v) ?? v));

  return (
    <div className="flex w-64 flex-col gap-2">
      <Input
        autoFocus
        placeholder="Search values…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button type="button" className="hover:text-foreground" onClick={() => selectVisible(true)}>
          Select all{search ? " shown" : ""}
        </button>
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => selectVisible(false)}
        >
          Clear
        </button>
      </div>
      <div
        className="max-h-64 overflow-y-auto rounded-md border"
        role="listbox"
        aria-multiselectable
      >
        {error && <p className="p-2 text-xs text-destructive">{error}</p>}
        {!values && !error && (
          <div className="space-y-1 p-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {values && visible.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">No values</p>
        )}
        {visible.map((v) => (
          <label
            key={toKey(v.value)}
            htmlFor={`cbf-${toKey(v.value)}`}
            className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-accent/5"
          >
            <Checkbox
              id={`cbf-${toKey(v.value)}`}
              checked={isChecked(v.value)}
              onCheckedChange={() => toggle(v.value)}
            />
            <span
              className={v.value === null ? "truncate italic text-muted-foreground" : "truncate"}
            >
              {display(v.value)}
            </span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{v.count}</span>
          </label>
        ))}
        {values && values.length >= DISTINCT_CAP && (
          <p className="p-2 text-xs text-muted-foreground">
            First {DISTINCT_CAP} values — search to narrow.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={apply} disabled={!values}>
          OK
        </Button>
      </div>
    </div>
  );
}
