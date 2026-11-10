"use client";

// US7 (F183, specs/subscriptions FR-015): the match where the row or the receipt already is. A bank row offered to a
// subscription's period shows *Subscription X · 2026-10 — Create & link* in the banking panel and the linking inbox
// (above the scored suggestions, a button — never the inbox's `Enter`: a creation is never one key); a receipt / bill
// offers *From subscription X (2026-10)* first among *Make it…* on the review page and in the documents inbox. Both
// open the period's confirm (US3 / US4) with the row / the document picked. Derived on read, nothing stored.
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { InfoBanner } from "@/kernel/ui/info-banner";
import { subscriptionMatchesAction } from "../subscriptions.actions";
import type { SubscriptionMatch } from "../types";
import { ConfirmPeriodDialog, type ConfirmTarget } from "./confirm-period-dialog";

export type MatchSubject = { bankTransactionId: string } | { documentId: string };

/** The subscription periods a row / a document is offered to; empty while loading, on an error, or disabled. */
export function useSubscriptionMatches(
  subject: MatchSubject | null,
  { enabled = true, refreshKey = 0 }: { enabled?: boolean; refreshKey?: number } = {},
): SubscriptionMatch[] {
  const [matches, setMatches] = useState<SubscriptionMatch[]>([]);
  const { executeAsync } = useAction(subscriptionMatchesAction);
  const rowId = subject && "bankTransactionId" in subject ? subject.bankTransactionId : null;
  const documentId = subject && "documentId" in subject ? subject.documentId : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-reads on purpose
  useEffect(() => {
    setMatches([]);
    if (!enabled || (!rowId && !documentId)) return;
    let live = true;
    void executeAsync(rowId ? { bankTransactionId: rowId } : { documentId: documentId as string })
      .then((r) => {
        const d = r?.data && "data" in r.data ? r.data.data : null;
        if (live && Array.isArray(d)) setMatches(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rowId, documentId, enabled, refreshKey, executeAsync]);
  return matches;
}

/** how sure the match is, in a few words: exact / VAT number matches / n % off, and *also offered elsewhere* */
function useHow() {
  const t = useT();
  return (m: SubscriptionMatch, kind: "row" | "document") =>
    [
      m.sure
        ? kind === "row"
          ? t("subscriptions.match.exact")
          : t("subscriptions.period.certain")
        : m.diffPct !== null
          ? t("subscriptions.period.diff", { pct: m.diffPct })
          : null,
      m.ambiguous ? t("subscriptions.period.ambiguous") : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

/**
 * The banking panel's / the linking inbox's line: one banner per period the row is offered to, *Create & link*
 * (or *Complete {key}* when the period already has its entity) opening the confirm with the row picked.
 */
export function SubscriptionRowMatch({
  bankTransactionId,
  canWrite,
  refreshKey = 0,
  onConfirmed,
}: {
  bankTransactionId: string;
  canWrite: boolean;
  refreshKey?: number;
  onConfirmed?: () => void;
}) {
  const t = useT();
  const how = useHow();
  const [version, setVersion] = useState(0);
  const matches = useSubscriptionMatches(
    { bankTransactionId },
    { refreshKey: refreshKey + version },
  );
  const [target, setTarget] = useState<ConfirmTarget | null>(null);
  if (matches.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="subscription-row-match">
      {matches.map((m) => (
        <InfoBanner
          key={`${m.subscriptionId}|${m.periodDate}`}
          action={
            canWrite ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setTarget({
                    subscriptionId: m.subscriptionId,
                    periodDate: m.periodDate,
                    bankTransactionId,
                  })
                }
                data-testid="subscription-match-confirm"
              >
                {m.entityKey
                  ? t("subscriptions.match.complete", { key: m.entityKey })
                  : t("subscriptions.match.createAndLink")}
              </Button>
            ) : undefined
          }
        >
          <div className="truncate font-medium" data-testid="subscription-match-label">
            {t("subscriptions.match.row", { name: m.name, period: m.period })}
          </div>
          <div className="text-xs text-muted-foreground">
            {how(m, "row") && <>{how(m, "row")} · </>}
            <Link href={`/subscriptions?open=${m.subscriptionId}`}>
              {t("subscriptions.match.open")}
            </Link>
          </div>
        </InfoBanner>
      ))}
      <ConfirmPeriodDialog
        target={target}
        onClose={() => setTarget(null)}
        onConfirmed={() => {
          setVersion((v) => v + 1);
          onConfirmed?.();
        }}
      />
    </div>
  );
}

/**
 * *Make it… → From subscription X (2026-10)* — one button per period the document is offered to, first in the
 * host's row of buttons; the host reads the matches (`useSubscriptionMatches`) to give it the primary.
 */
export function FromSubscriptionButtons({
  documentId,
  matches,
  variant = "default",
  onConfirmed,
}: {
  documentId: string;
  matches: SubscriptionMatch[];
  variant?: "default" | "secondary" | "outline";
  onConfirmed?: () => void;
}) {
  const t = useT();
  const how = useHow();
  const [target, setTarget] = useState<ConfirmTarget | null>(null);
  if (matches.length === 0) return null;
  return (
    <>
      {matches.map((m, i) => (
        <Button
          key={`${m.subscriptionId}|${m.periodDate}`}
          size="sm"
          variant={i === 0 ? variant : "outline"}
          title={how(m, "document") || undefined}
          onClick={() =>
            setTarget({ subscriptionId: m.subscriptionId, periodDate: m.periodDate, documentId })
          }
          data-testid="make-it-from-subscription"
        >
          {t("subscriptions.match.fromSubscription", { name: m.name, period: m.period })}
        </Button>
      ))}
      <ConfirmPeriodDialog
        target={target}
        onClose={() => setTarget(null)}
        onConfirmed={() => onConfirmed?.()}
      />
    </>
  );
}
