"use client";

// Excel's date filter: a year → month → day tree with tri-state checkboxes and counts (over the set
// filtered by the other columns), presets, and a custom from/to range. Selection is kept at leaf
// (day) level and compressed to year/month/day tokens on OK.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import type { DateHierarchy, DatesFilter, Filter } from "@/kernel/list-query/types";

export interface DateFilterProps {
  current: Filter | null;
  load: () => Promise<DateHierarchy>;
  onApply: (filter: Filter | null) => void;
  onClose: () => void;
}

/** `2026-07` → `Jul` · `juil.` · `juli` — the month's short name in the UI language. */
export function monthName(month: string, lang: string): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
  return new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" }).format(d);
}

const PRESETS = [
  ["thisMonth", "table.filter.preset.thisMonth"],
  ["lastMonth", "table.filter.preset.lastMonth"],
  ["thisQuarter", "table.filter.preset.thisQuarter"],
  ["thisYear", "table.filter.preset.thisYear"],
  ["lastYear", "table.filter.preset.lastYear"],
] as const satisfies readonly (readonly [string, MessageKey])[];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function presetRange(
  name: "thisMonth" | "lastMonth" | "thisQuarter" | "thisYear" | "lastYear",
  today = new Date(),
): { from: string; to: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const range = (a: Date, b: Date) => ({
    from: iso(a),
    to: iso(new Date(b.getTime() - 86_400_000)),
  });
  switch (name) {
    case "thisMonth":
      return range(new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 1)));
    case "lastMonth":
      return range(new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1)));
    case "thisQuarter": {
      const q = Math.floor(m / 3) * 3;
      return range(new Date(Date.UTC(y, q, 1)), new Date(Date.UTC(y, q + 3, 1)));
    }
    case "thisYear":
      return range(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)));
    case "lastYear":
      return range(new Date(Date.UTC(y - 1, 0, 1)), new Date(Date.UTC(y, 0, 1)));
  }
}

/** Leaf days of the hierarchy that a filter's year/month/day tokens cover. */
function expand(f: DatesFilter | null, h: DateHierarchy): Set<string> {
  const out = new Set<string>();
  if (!f) return out;
  for (const y of h.years) {
    for (const m of y.months) {
      for (const d of m.days) {
        if (f.years?.includes(y.year) || f.months?.includes(m.month) || f.days?.includes(d.day))
          out.add(d.day);
      }
    }
  }
  return out;
}

/** Day set → the shortest token list (whole years, then whole months, then days). */
export function compress(
  selected: Set<string>,
  h: DateHierarchy,
): Pick<DatesFilter, "years" | "months" | "days"> {
  const years: number[] = [];
  const months: string[] = [];
  const days: string[] = [];
  for (const y of h.years) {
    const yearDays = y.months.flatMap((m) => m.days.map((d) => d.day));
    if (yearDays.length && yearDays.every((d) => selected.has(d))) {
      years.push(y.year);
      continue;
    }
    for (const m of y.months) {
      const monthDays = m.days.map((d) => d.day);
      if (monthDays.length && monthDays.every((d) => selected.has(d))) {
        months.push(m.month);
        continue;
      }
      for (const d of monthDays) if (selected.has(d)) days.push(d);
    }
  }
  return {
    ...(years.length ? { years } : {}),
    ...(months.length ? { months } : {}),
    ...(days.length ? { days } : {}),
  };
}

type Tri = "all" | "some" | "none";
function tri(days: string[], selected: Set<string>): Tri {
  const n = days.filter((d) => selected.has(d)).length;
  return n === 0 ? "none" : n === days.length ? "all" : "some";
}

export function DateFilter({ current, load, onApply, onClose }: DateFilterProps) {
  const t = useT();
  const lang = useUiLanguage();
  const initial = current?.kind === "dates" ? current : null;
  const [h, setH] = useState<DateHierarchy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const [from, setFrom] = useState(initial?.from ?? "");
  const [to, setTo] = useState(initial?.to ?? "");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    load()
      .then((hier) => {
        if (!active) return;
        setH(hier);
        setSelected(expand(initial, hier));
        setOpen(new Set(hier.years.slice(0, 1).map((y) => String(y.year))));
      })
      .catch(
        (e: unknown) =>
          active && setError(e instanceof Error ? e.message : t("table.filter.loadFailed")),
      );
    return () => {
      active = false;
    };
  }, [load, initial, t]);

  const hasTree = !!(initial?.years || initial?.months || initial?.days);
  const allDays = useMemo(
    () => h?.years.flatMap((y) => y.months.flatMap((m) => m.days.map((d) => d.day))) ?? [],
    [h],
  );

  function setDays(days: string[], on: boolean) {
    const next = new Set(selected);
    for (const d of days) {
      if (on) next.add(d);
      else next.delete(d);
    }
    setSelected(next);
    setTouched(true);
  }
  const toggleOpen = (k: string) => {
    const next = new Set(open);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setOpen(next);
  };

  function apply() {
    if (!h) return;
    const treeActive = touched ? selected.size > 0 && selected.size < allDays.length : hasTree;
    const tokens = treeActive ? compress(selected, h) : {};
    const bounds = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    const f: DatesFilter = { kind: "dates", ...tokens, ...bounds };
    const empty = !f.years && !f.months && !f.days && !f.from && !f.to;
    if (touched && selected.size === 0 && !from && !to) onApply({ kind: "dates", empty: true });
    else onApply(empty ? null : f);
    onClose();
  }

  const preset = (r: { from: string; to: string }) => {
    onApply({ kind: "dates", ...r });
    onClose();
  };

  const row = (
    label: string,
    count: number,
    state: Tri,
    days: string[],
    depth: number,
    key?: string,
  ) => (
    <div
      className="flex items-center gap-1.5 py-0.5 text-sm"
      style={{ paddingLeft: `${depth * 1.1}rem` }}
    >
      {key ? (
        <button
          type="button"
          onClick={() => toggleOpen(key)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t(open.has(key) ? "table.filter.collapse" : "table.filter.expand")}
        >
          {open.has(key) ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
      ) : (
        <span className="inline-block w-3.5" />
      )}
      <Checkbox
        checked={state === "all"}
        indeterminate={state === "some"}
        onCheckedChange={() => setDays(days, state !== "all")}
      />
      <span className="truncate">{label}</span>
      <span className="ml-auto pr-1 text-xs tabular-nums text-muted-foreground">{count}</span>
    </div>
  );

  return (
    <div className="flex w-72 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([k, label]) => (
          <Button
            key={k}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => preset(presetRange(k))}
          >
            {t(label)}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8"
          aria-label={t("table.filter.from")}
        />
        <span className="text-xs text-muted-foreground">{t("table.filter.to")}</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8"
          aria-label={t("table.filter.until")}
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border px-1" role="tree">
        {error && <p className="p-2 text-xs text-destructive">{error}</p>}
        {!h && !error && (
          <div className="space-y-1 p-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {h?.years.map((y) => {
          const yDays = y.months.flatMap((m) => m.days.map((d) => d.day));
          const yKey = String(y.year);
          return (
            <div key={yKey}>
              {row(yKey, y.count, tri(yDays, selected), yDays, 0, yKey)}
              {open.has(yKey) &&
                y.months.map((m) => {
                  const mDays = m.days.map((d) => d.day);
                  return (
                    <div key={m.month}>
                      {row(
                        monthName(m.month, lang),
                        m.count,
                        tri(mDays, selected),
                        mDays,
                        1,
                        m.month,
                      )}
                      {open.has(m.month) &&
                        m.days.map((d) => (
                          <div key={d.day}>
                            {row(d.day.slice(8, 10), d.count, tri([d.day], selected), [d.day], 2)}
                          </div>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {h && h.years.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">{t("table.filter.noDates")}</p>
        )}
        {h && h.empty > 0 && (
          <div className="flex items-center gap-1.5 border-t py-1 text-sm">
            <span className="inline-block w-3.5" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1 italic text-muted-foreground"
              onClick={() => {
                onApply({ kind: "dates", empty: true });
                onClose();
              }}
            >
              {t("common.blanks")}
            </Button>
            <span className="ml-auto pr-1 text-xs tabular-nums text-muted-foreground">
              {h.empty}
            </span>
          </div>
        )}
      </div>
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onApply(null);
            onClose();
          }}
          disabled={!current}
        >
          {t("table.filter.clear")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={apply} disabled={!h}>
            {t("table.filter.ok")}
          </Button>
        </div>
      </div>
    </div>
  );
}
