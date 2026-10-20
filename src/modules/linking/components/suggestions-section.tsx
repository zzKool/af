"use client";

// Suggestions (specs/linking/spec.md US1, US2): for a bank row (what it could justify) or for an entity (which
// rows could pay it) — the top candidates with their confidence and reasons, the allocation to edit, *Link*;
// below it *Link to…*, a search over every registered linkable for the cases nothing was suggested.
// Self-loading from the endpoint; the owner links, the accountant sees.
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import {
  applySuggestionAction,
  searchLinkablesAction,
  suggestionsForEntityAction,
  suggestionsForTransactionAction,
} from "@/modules/linking/linking.actions";
import type {
  Confidence,
  EntityFacts,
  LinkableType,
  LinkEndpoint,
  Suggestion,
} from "@/modules/linking/types";

export const CONFIDENCE_STYLE: Record<Confidence, string> = {
  HIGH: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  LOW: "bg-muted text-muted-foreground",
};

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

/** The scorer's reasons are English data; the known ones have a key, the parametrised ones print as they are. */
const REASON_KEY: Record<string, string> = {
  "Invoice number in message": "linking.reason.invoiceNumber",
  "Expense key in message": "linking.reason.expenseKey",
  "Document key in message": "linking.reason.documentKey",
  "Partial invoice number match": "linking.reason.partialNumber",
  "Client name match": "linking.reason.clientName",
  "Supplier name match": "linking.reason.supplierName",
  "Partner name match": "linking.reason.partnerName",
  "Description keyword match": "linking.reason.keyword",
  "Exact amount match": "linking.reason.amountExact",
  "Very close amount match": "linking.reason.amountClose",
  "Amount within tolerance": "linking.reason.amountTolerance",
  "Approximate amount match": "linking.reason.amountApprox",
  "Same date": "linking.reason.sameDate",
  "Within 2 days": "linking.reason.within2",
  "Within 5 days": "linking.reason.within5",
  "Currency differs but reference matches": "linking.reason.currencyRef",
  "Cross-currency match (no rate to compare)": "linking.reason.crossNoRate",
};

export function useReasonLabel() {
  const t = useT();
  return (reason: string): string => {
    const key = REASON_KEY[reason];
    if (key) return t(key as Parameters<typeof t>[0]);
    const days = /^(\d+) days apart$/.exec(reason);
    if (days) return t("linking.reason.daysApart", { days: days[1] ?? "" });
    return reason;
  };
}

export type SuggestionsTarget =
  | { bankTransactionId: string }
  | { endpoint: LinkEndpoint; types?: LinkableType[] };

export function SuggestionsSection({
  target,
  canWrite,
  onLinked,
  refreshKey = 0,
}: {
  target: SuggestionsTarget;
  canWrite: boolean;
  /** a link was created — the host reloads its own view */
  onLinked?: () => void;
  /** bump it when the host changed the links some other way (an unlink) — the suggestions reload */
  refreshKey?: number;
}) {
  const t = useT();
  const ids = useId();
  const reasonLabel = useReasonLabel();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [self, setSelf] = useState<EntityFacts | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EntityFacts[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const { executeAsync: loadForRow } = useAction(suggestionsForTransactionAction);
  const { executeAsync: loadForEntity } = useAction(suggestionsForEntityAction);
  const { executeAsync: search } = useAction(searchLinkablesAction);
  const { executeAsync: apply, isPending: applying } = useAction(applySuggestionAction);

  const rowMode = "bankTransactionId" in target;
  // the target as plain values, so the hooks depend on what identifies it and not on the object
  const bankTransactionId = rowMode ? target.bankTransactionId : null;
  const endpointType = rowMode ? null : target.endpoint.type;
  const endpointId = rowMode ? null : target.endpoint.id;

  const reload = useCallback(async () => {
    const r = bankTransactionId
      ? await loadForRow({ bankTransactionId })
      : endpointType && endpointId
        ? await loadForEntity({ type: endpointType, id: endpointId })
        : null;
    const error = extractError(r);
    if (error) {
      setSuggestions([]);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return;
    const list = d.suggestions;
    setSuggestions(list);
    setSelf("row" in d ? d.row : d.entity);
    setAllocations(Object.fromEntries(list.map((s) => [s.candidate.id, s.allocation ?? ""])));
  }, [bankTransactionId, endpointType, endpointId, loadForRow, loadForEntity]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the host's signal to reload
  useEffect(() => {
    setSuggestions(null);
    setHits(null);
    setQuery("");
    setSearchOpen(false);
    void reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const h = setTimeout(async () => {
      const r = await search({
        q,
        types: rowMode ? undefined : ["bank_transaction"],
      });
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (!cancelled && d)
        setHits(d.filter((x) => !self || x.type !== self.type || x.id !== self.id));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [query, searchOpen, search, rowMode, self]);

  async function link(candidate: EntityFacts, allocation: string | null) {
    const input = bankTransactionId
      ? { bankTransactionId, to: { type: candidate.type, id: candidate.id } }
      : {
          bankTransactionId: candidate.id,
          to: { type: endpointType as LinkableType, id: endpointId as string },
        };
    const r = await apply({
      ...input,
      allocatedAmount: allocation?.trim() ? allocation.trim() : undefined,
    });
    const error = extractError(r);
    if (error) return toast.error(error);
    toast.success(t("linking.linked", { label: candidate.label }));
    onLinked?.();
    void reload();
  }

  const exhausted = self !== null && Number(self.remaining) <= 0;

  return (
    <section data-testid="suggestions">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("linking.suggestions.title")}</h3>
        {self && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("linking.suggestions.remaining", { amount: money(self.remaining, self.currency) })}
          </span>
        )}
      </div>
      {suggestions === null ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : exhausted ? (
        <p className="text-sm text-muted-foreground">{t("linking.suggestions.exhausted")}</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("linking.suggestions.none")}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {suggestions.map((s, i) => (
            <li
              key={s.candidate.id}
              className="flex flex-col gap-1 px-3 py-2"
              data-testid="suggestion"
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={CONFIDENCE_STYLE[s.confidence]}
                  data-testid="suggestion-confidence"
                >
                  {t(`linking.confidence.${s.confidence}`)}
                </Badge>
                <span className="min-w-0 flex-1 truncate" title={s.candidate.label}>
                  <span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>
                  {s.candidate.label}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {s.score}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {s.reasons.map(reasonLabel).join(" · ")}
              </div>
              {canWrite && (
                <div className="flex items-center gap-2">
                  {s.allocation !== null ? (
                    <>
                      <label
                        htmlFor={`${ids}-${s.candidate.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        {t("linking.allocation")}
                      </label>
                      <Input
                        id={`${ids}-${s.candidate.id}`}
                        className="h-7 w-32 text-right tabular-nums"
                        inputMode="decimal"
                        value={allocations[s.candidate.id] ?? ""}
                        onChange={(e) =>
                          setAllocations((a) => ({
                            ...a,
                            [s.candidate.id]: e.target.value.replace(",", "."),
                          }))
                        }
                        data-testid="suggestion-allocation"
                      />
                      <span className="text-xs text-muted-foreground">{s.candidate.currency}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("linking.crossCurrencyHint")}
                    </span>
                  )}
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={applying || (s.allocation !== null && !allocations[s.candidate.id])}
                    onClick={() =>
                      void link(
                        s.candidate,
                        s.allocation !== null ? (allocations[s.candidate.id] ?? null) : null,
                      )
                    }
                    data-testid="suggestion-link"
                  >
                    {t("linking.link")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && !exhausted && (
        <div className="mt-2">
          {!searchOpen ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSearchOpen(true)}
              data-testid="link-to"
            >
              {t("linking.linkTo")}
            </Button>
          ) : (
            <div className="grid gap-2">
              <Input
                placeholder={rowMode ? t("linking.search.entities") : t("linking.search.rows")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                data-testid="link-search"
              />
              {hits && (
                <ul className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
                  {hits.length === 0 && (
                    <li className="px-3 py-2 text-muted-foreground">{t("linking.search.none")}</li>
                  )}
                  {hits.map((h) => (
                    <li
                      key={`${h.type}:${h.id}`}
                      className="flex items-center gap-2 px-3 py-1.5"
                      data-testid="link-hit"
                    >
                      <Badge variant="outline" className="shrink-0">
                        {t(`linking.type.${h.type}`)}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate" title={h.label}>
                        {h.label}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {Number(h.remaining) > 0 ? money(h.remaining, h.currency) : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={applying}
                        onClick={() => void link(h, null)}
                        data-testid="link-hit-link"
                      >
                        {t("linking.link")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
