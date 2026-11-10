// US7 (F183, specs/subscriptions FR-015): the match where the row or the receipt already is — which subscription
// period a bank row / an inbox document is offered to, read through the same one pass as the page
// (`loadSubscriptions`), so the banking panel, the linking inbox, the review page and the documents inbox say what
// the subscriptions page says. Read only: the owner's click runs the same confirm (US3 / US4).
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type LoadedSubscription, loadSubscriptions } from "./facts";
import type { Cadence, PeriodView, SubscriptionMatch } from "./types";

export const periodName = (date: string, cadence: Cadence) =>
  cadence === "yearly" ? date.slice(0, 4) : date.slice(0, 7);

function toMatch(
  s: LoadedSubscription,
  p: PeriodView,
  offer: { ambiguous: boolean; diffPct: string | null },
  sure: boolean,
): SubscriptionMatch {
  return {
    subscriptionId: s.subscription.id,
    name: s.subscription.name,
    becomes: s.subscription.becomes,
    cadence: s.subscription.cadence,
    periodDate: p.date,
    period: periodName(p.date, s.subscription.cadence),
    state: p.state,
    entityKey: p.entities[0]?.key ?? null,
    sure,
    ambiguous: offer.ambiguous,
    diffPct: offer.diffPct,
  };
}

/** sure and unambiguous first, then the closest amount, then the latest period */
function rank(a: SubscriptionMatch, b: SubscriptionMatch): number {
  if (a.sure !== b.sure) return a.sure ? -1 : 1;
  if (a.ambiguous !== b.ambiguous) return a.ambiguous ? 1 : -1;
  const da = a.diffPct === null ? Number.POSITIVE_INFINITY : Number(a.diffPct);
  const db = b.diffPct === null ? Number.POSITIVE_INFINITY : Number(b.diffPct);
  if (da !== db) return da - db;
  return b.periodDate.localeCompare(a.periodDate);
}

/** Every subscription period the bank row is offered to (empty when none). */
export async function matchForRow(
  tx: TransactionClient,
  caller: CallerIdentity,
  rowId: string,
  today: string,
): Promise<SubscriptionMatch[]> {
  const loaded = await loadSubscriptions(tx, caller, today);
  return loaded
    .flatMap((s) =>
      s.periods.flatMap((p) =>
        p.rows.filter((r) => r.rowId === rowId).map((r) => toMatch(s, p, r, r.exact)),
      ),
    )
    .sort(rank);
}

/** Every subscription period the inbox document (a receipt / a bill) is offered to (empty when none). */
export async function matchForDocument(
  tx: TransactionClient,
  caller: CallerIdentity,
  documentId: string,
  today: string,
): Promise<SubscriptionMatch[]> {
  const loaded = await loadSubscriptions(tx, caller, today);
  return loaded
    .flatMap((s) =>
      s.periods.flatMap((p) =>
        p.documents
          .filter((d) => d.documentId === documentId)
          .map((d) => toMatch(s, p, d, d.certain)),
      ),
    )
    .sort(rank);
}
