"use client";

// F179 — the new-expense form's extras, as the board *Pulse — Expenses* draws them: the payer as a segmented control
// with what it means, the base at the ECB rate of a foreign amount, the key the receipt will be filed as, and the
// trip's traktamente as a switch. The previews are reads (`previewNewExpenseAction`): nothing is stored from them —
// `createExpense` takes the key from the counter and writes the base itself, once.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import type { CURRENCIES } from "@/kernel/nav/constants";
import { cn } from "@/lib/utils";
import { previewNewExpenseAction } from "@/modules/expenses/expenses.actions";
import type {
  CategoryOption,
  ExpensePreview,
  GroupOption,
  SourceOption,
} from "@/modules/expenses/types";
import { getTripAction } from "@/modules/traktamente/ui";
import { EXPENSES_BASE } from "./expense-table";

/** how long the previews wait after the last keystroke */
export const PREVIEW_DEBOUNCE_MS = 250;

/** The payer, one click (the board's segmented *Paid with*) — the same accounts the select offered. */
export function PaidWithControl({
  id,
  label,
  sources,
  value,
  onChange,
}: {
  id: string;
  label: string;
  sources: readonly SourceOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const picked = sources.find((s) => s.id === value);
  return (
    <div>
      <span id={`${id}-label`} className="mb-1 block text-xs font-medium">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-subtle bg-surface-2 p-[3px]"
        data-testid="expense-paid-with"
      >
        {sources.map((s) => {
          const on = s.id === value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: the board's segmented buttons, announced as the radios they are
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(s.id)}
              className={cn(
                "h-7 rounded-[7px] px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "bg-action font-semibold text-action-fg"
                  : "text-muted-foreground hover:bg-hover",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {picked && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="paid-with-hint">
          {t(
            picked.kind === "private"
              ? "expenses.form.paidPrivately"
              : "expenses.form.paidByCompany",
          )}
        </p>
      )}
    </div>
  );
}

/** The key and the base the form previews — debounced, the last answer wins, nothing while closed. */
export function useExpensePreview(
  open: boolean,
  input: { groupId: string; basCode: string; date: string; amount: string; currency: string },
): ExpensePreview {
  const { executeAsync } = useAction(previewNewExpenseAction);
  const [preview, setPreview] = useState<ExpensePreview>({ key: null, base: null });
  const seq = useRef(0);
  const groupId = /^[0-9a-f-]{36}$/.test(input.groupId) ? input.groupId : undefined;
  const basCode = /^\d{4}$/.test(input.basCode) ? input.basCode : undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : "";
  const amount = input.amount.trim();
  const currency = input.currency;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are the key; `executeAsync` is stable enough
  useEffect(() => {
    const mine = ++seq.current;
    if (!open || !date || (!(groupId && basCode) && currency === EXPENSES_BASE)) {
      setPreview({ key: null, base: null });
      return;
    }
    const timer = setTimeout(() => {
      executeAsync({
        groupId,
        basCode,
        date,
        amount: amount.replace(",", ".").replace(/\s/g, "") || undefined,
        currency: currency as (typeof CURRENCIES)[number],
      })
        .then((r) => {
          if (seq.current === mine) setPreview(r?.data?.data ?? { key: null, base: null });
        })
        .catch(() => {
          if (seq.current === mine) setPreview({ key: null, base: null });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, groupId, basCode, date, amount, currency]);
  return preview;
}

/** *In SEK at ECB 2026-07-06 (11.786)* — the base a foreign amount will get; display only. */
export function BasePreviewLine({ base }: { base: ExpensePreview["base"] }) {
  const t = useT();
  if (!base) return null;
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px] sm:col-span-2"
      data-testid="expense-base-preview"
    >
      <span className="text-muted-foreground">
        {t(
          base.rateSource === "ecb_nearest"
            ? "expenses.form.basePreviewNearest"
            : "expenses.form.basePreview",
          { currency: EXPENSES_BASE, date: base.rateDate ?? "", rate: base.rate },
        )}
      </span>
      <b className="font-mono tabular-nums">{formatMoney(base.amountBase, EXPENSES_BASE)}</b>
    </div>
  );
}

/** *Will be filed as Ex2-Tr-05_2026-07-06_* — read-only, from the key functions; the counter may move before Save. */
export function KeyPreviewLine({ fileKey }: { fileKey: string | null }) {
  const t = useT();
  if (!fileKey) return null;
  return (
    <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="expense-key-preview">
      {t("expenses.form.willBeFiled")} <span className="font-mono text-foreground">{fileKey}</span>
    </p>
  );
}

/** The travel category the per-diem goes to — the trip panel's rule: aliased `Tr`, else the 58xx group, else none. */
export function travelCategory(categories: readonly CategoryOption[]): string {
  return (
    categories.find((c) => c.alias === "Tr" || /\(Tr\)$/.test(c.label))?.code ??
    categories.find((c) => c.code.startsWith("58"))?.code ??
    ""
  );
}

export type TripPerDiem = { days: number; total: string };

/**
 * The trip's traktamente the form may write (the board's switch): the group is a trip whose breakdown is computed
 * (its times, country and meals saved on the group's trip panel) and has no per-diem expense yet. `refresh` re-reads
 * it after a save.
 */
export function useTripPerDiem(
  open: boolean,
  groupId: string,
  groups: readonly GroupOption[],
): { perDiem: TripPerDiem | null; refresh: () => void } {
  const { executeAsync } = useAction(getTripAction);
  const [perDiem, setPerDiem] = useState<TripPerDiem | null>(null);
  const [tick, setTick] = useState(0);
  const isTrip = groups.find((g) => g.id === groupId)?.kind === "trip";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads after a save
  useEffect(() => {
    setPerDiem(null);
    if (!open || !isTrip) return;
    let live = true;
    executeAsync({ groupId })
      .then((r) => {
        const res = r?.data;
        const trip = res && "data" in res ? res.data : null;
        if (!live || !trip?.computed || trip.perDiemExpenseId) return;
        if (!(trip.computed.days > 0) || !(Number(trip.computed.total) > 0)) return;
        setPerDiem({ days: trip.computed.days, total: trip.computed.total });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, isTrip, groupId, tick]);
  return { perDiem, refresh: () => setTick((n) => n + 1) };
}

/** *Add traktamente for the 3 trip days* — off until the owner turns it on; Save then writes the per-diem too. */
export function PerDiemSwitch({
  perDiem,
  on,
  onChange,
}: {
  perDiem: TripPerDiem;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useT();
  const label = t("expenses.form.perDiem", { days: String(perDiem.days) });
  return (
    <div className="flex items-center gap-3 sm:col-span-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        data-testid="expense-per-diem"
        className={cn(
          "relative h-[22px] w-[38px] shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          on ? "bg-state-done" : "bg-subtle",
        )}
      >
        <i
          aria-hidden
          className={cn(
            "absolute top-[3px] size-4 rounded-full bg-surface shadow-card transition-[left]",
            on ? "left-[19px]" : "left-[3px]",
          )}
        />
      </button>
      <span className="text-[12.5px]">
        {label}{" "}
        <span className="text-muted-foreground">
          {t("expenses.form.perDiemAmount", { amount: formatMoney(perDiem.total, EXPENSES_BASE) })}
        </span>
      </span>
    </div>
  );
}
