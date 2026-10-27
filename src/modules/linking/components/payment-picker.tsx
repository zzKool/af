"use client";

// The payment picker (F97 US2, review 2026-10-26 §1.2): which bank row pays this entity — the scored rows first
// (`suggestionsForEntity`: confidence, reasons, one click), then a search (text · amount ± 1 % · date) over the
// rows the host loaded. A selection component: it hands the chosen row back; the host records the payment
// through its module's own action (D37, F58). Replaces the `<Select>` of every open row on the supplier-invoice
// and the expense panels.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { suggestionsForEntityAction } from "../linking.actions";
import type { LinkEndpoint, Suggestion } from "../types";
import { ConfidenceLabel } from "./confidence-label";
import { useReasonLabel } from "./suggestions-section";

/** A row the host can pay with — what its picker list carried before. */
export type PickableRow = {
  id: string;
  bookingDate: string;
  /** signed */
  amount: string;
  currency: string;
  description: string;
  accountLabel: string;
  /** what the row can still pay, when the host knows it */
  remaining?: string;
};

const SHOWN = 8;

/** The search over the host's rows: a date prefix, an amount within ± 1 %, else the text. Pure. */
export function searchRows<R extends PickableRow>(rows: readonly R[], query: string): R[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(q)) return rows.filter((r) => r.bookingDate.startsWith(q));
  const amount = Number(q.replace(/\s/g, "").replace(",", "."));
  if (q !== "" && Number.isFinite(amount) && /^[\d\s.,-]+$/.test(q)) {
    const wanted = Math.abs(amount);
    return rows.filter((r) => {
      const a = Math.abs(Number(r.amount));
      return Math.abs(a - wanted) <= Math.max(0.005, wanted * 0.01);
    });
  }
  return rows.filter(
    (r) =>
      r.description.toLowerCase().includes(q) ||
      r.accountLabel.toLowerCase().includes(q) ||
      r.bookingDate.includes(q),
  );
}

function RowLine({ row, left }: { row: PickableRow; left: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col tabular-nums">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{row.bookingDate}</span>
        <span className="font-medium">
          {formatMoney(row.amount, row.currency, { signed: true })}
        </span>
        {row.remaining && row.remaining !== row.amount.replace("-", "") && (
          <span className="text-xs text-muted-foreground">
            ({formatMoney(row.remaining, row.currency)} {left})
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="truncate">{row.description}</span>
        <span className="shrink-0">· {row.accountLabel}</span>
      </span>
    </span>
  );
}

export function PaymentPicker({
  entity,
  rows,
  value,
  onChange,
  refreshKey = 0,
}: {
  /** the entity the rows would pay (its scored suggestions) */
  entity: LinkEndpoint;
  /** the rows the host can pay with (its own read: the search pool) */
  rows: readonly PickableRow[];
  /** the chosen row id, or null */
  value: string | null;
  onChange: (rowId: string | null) => void;
  /** bump it when the host changed the links (a payment recorded) — the suggestions reload */
  refreshKey?: number;
}) {
  const t = useT();
  const ids = useId();
  const reasonLabel = useReasonLabel();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [query, setQuery] = useState("");
  const { executeAsync: load } = useAction(suggestionsForEntityAction);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the host's signal to reload
  useEffect(() => {
    let live = true;
    void load({ type: entity.type, id: entity.id }).then((r) => {
      if (!live) return;
      const error = extractError(r);
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      setSuggestions(error || !d ? [] : d.suggestions);
    });
    return () => {
      live = false;
    };
  }, [entity.type, entity.id, load, refreshKey]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const hits = useMemo(() => searchRows(rows, query).slice(0, SHOWN), [rows, query]);
  const suggested = (suggestions ?? []).filter((s) => byId.has(s.candidate.id));
  const selected = value ? (byId.get(value) ?? null) : null;

  return (
    <div className="flex flex-col gap-2" data-testid="payment-picker">
      {selected ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px]">
          <RowLine row={selected} left={t("linking.picker.left")} />
          <Button
            size="sm"
            variant="link"
            className="shrink-0"
            onClick={() => onChange(null)}
            data-testid="payment-picker-clear"
          >
            {t("linking.picker.change")}
          </Button>
        </div>
      ) : (
        <>
          {suggestions === null ? (
            <p className="text-xs text-muted-foreground">…</p>
          ) : suggested.length > 0 ? (
            <ul
              className="divide-y rounded-md border text-[13px]"
              data-testid="payment-suggestions"
            >
              {suggested.map((s) => {
                const row = byId.get(s.candidate.id) as PickableRow;
                return (
                  <li key={s.candidate.id} className="flex flex-col gap-0.5 px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <ConfidenceLabel
                        confidence={s.confidence}
                        testId="payment-suggestion-confidence"
                      />
                      <RowLine row={row} left={t("linking.picker.left")} />
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => onChange(row.id)}
                        data-testid="payment-suggestion-pick"
                      >
                        {t("linking.picker.pick")}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.reasons.map(reasonLabel).join(" · ")}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t("linking.picker.none")}</p>
          )}
          <div>
            <label htmlFor={`${ids}-search`} className="sr-only">
              {t("linking.picker.search")}
            </label>
            <Input
              id={`${ids}-search`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("linking.picker.search")}
              data-testid="payment-picker-search"
            />
          </div>
          {query.trim() !== "" && (
            <ul className="divide-y rounded-md border text-[13px]" data-testid="payment-hits">
              {hits.length === 0 ? (
                <li className="px-3 py-1.5 text-xs text-muted-foreground">
                  {t("linking.picker.noHits")}
                </li>
              ) : (
                hits.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 px-3 py-1.5">
                    <RowLine row={row} left={t("linking.picker.left")} />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => onChange(row.id)}
                      data-testid="payment-hit-pick"
                    >
                      {t("linking.picker.pick")}
                    </Button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
