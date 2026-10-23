// The words of an active filter, for its filter button in the DataTable's filter bar (D40: `Month: July 2026 ▾`
// buttons replace v2's removable chips — the button opens the same typed popover as the column header).
import { type MessageKey, type MessageParams, translator } from "@/kernel/i18n/translate";
import type { Filter } from "@/kernel/list-query/types";
import { TEXT_OP_KEYS } from "./filters/text-filter";

type T = (key: MessageKey, params?: MessageParams) => string;
const english = translator("en");

/** `t` = the UI language's translator (`useT()`); English when omitted (logs, tests). */
export function describeFilter(
  f: Filter,
  label?: (v: string | null) => string,
  t: T = english,
): string {
  const show = (v: string | null) => (v === null ? t("common.blanks") : (label?.(v) ?? v));
  switch (f.kind) {
    case "in": {
      const names = f.values.map(show);
      return names.length > 3
        ? `${names.slice(0, 3).join(", ")} +${names.length - 3}`
        : names.join(", ");
    }
    case "text":
      return f.value === undefined
        ? t(TEXT_OP_KEYS[f.op]).toLowerCase()
        : `${t(TEXT_OP_KEYS[f.op]).toLowerCase()} "${f.value}"`;
    case "range":
      if (f.empty) return t("table.filter.isEmpty");
      if (f.min !== undefined && f.max !== undefined)
        return f.min === f.max ? `= ${f.min}` : `${f.min} – ${f.max}`;
      return f.min !== undefined ? `≥ ${f.min}` : `≤ ${f.max}`;
    case "dates": {
      if (f.empty) return t("table.filter.isEmpty");
      const parts: string[] = [];
      const tokens = [...(f.years ?? []).map(String), ...(f.months ?? []), ...(f.days ?? [])];
      if (tokens.length)
        parts.push(
          tokens.length > 3
            ? `${tokens.slice(0, 3).join(", ")} +${tokens.length - 3}`
            : tokens.join(", "),
        );
      if (f.from && f.to) parts.push(`${f.from} → ${f.to}`);
      else if (f.from) parts.push(t("table.filter.fromDate", { date: f.from }));
      else if (f.to) parts.push(t("table.filter.toDate", { date: f.to }));
      return parts.join(" · ");
    }
  }
}
