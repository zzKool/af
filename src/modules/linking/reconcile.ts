// Reconcile — the match stage (F139, specs/linking/reconcile.md; the board *Reconcile*, D77): one month's rows to
// justify, grouped, each with the facts its stage shows — the partner and the category sure / proposed / asked, its
// twins, the bank's FX cost on a cross-currency candidate — today's links for the undo list, and the one composite
// write: accept a candidate and confirm the unsure fields in one transaction. The engine is F116's (`inboxRows`).
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import { stockholmDay } from "@/kernel/clock/clock";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import * as banking from "@/modules/banking";
import * as rates from "@/modules/rates";
import { inboxRows } from "./inbox";
import { ALLOCATING_KINDS } from "./kinds";
import { getLinkable } from "./linkable";
import {
  bankFxCost,
  type DoneLink,
  defaultReconcileMonth,
  type FxView,
  type ReconcileData,
  type ReconcileRow,
  reconcileGroup,
  stageFields,
  twinsOf,
} from "./reconcile-pure";
import { applySuggestion } from "./suggestions";
import type { LinkDto, LinkEndpoint } from "./types";

export * from "./reconcile-pure";

// --- the read ---

/** The months the default looks back over (US1). */
const LOOKBACK_MONTHS = 12;

export async function reconcileData(
  tx: TransactionClient,
  today: string,
  month: string | null,
): Promise<ReconcileData> {
  const thisMonth = today.slice(0, 7);
  const overview = await banking.bankMonths(tx, { today });
  const recent = overview.months.filter(
    (m) => m.month >= banking.addMonths(thisMonth, -LOOKBACK_MONTHS),
  );
  const wanted = month ?? defaultReconcileMonth(thisMonth, recent);
  const shown = wanted < overview.from ? overview.from : wanted > thisMonth ? thisMonth : wanted;
  const m = overview.months.find((x) => x.month === shown);

  const inbox = await inboxRows(tx, undefined, {
    from: `${shown}-01`,
    to: banking.lastDayOf(shown),
  });
  const twins = twinsOf(
    inbox.map((r) => ({
      id: r.row.id,
      accountId: r.list.bankAccountId,
      date: r.list.bookingDate,
      amount: r.list.amount,
      counterpartyKey: r.list.counterpartyKey,
    })),
  );

  const rows: ReconcileRow[] = [];
  for (const r of inbox) {
    const { partner, category } = stageFields(r, r.top);
    let fx: FxView | null = null;
    const c = r.top?.candidate;
    if (r.top?.crossCurrency && c?.currency && c.currency !== r.row.currency && r.row.currency) {
      const rate = await rates.rateToBase(tx, c.date, c.currency, r.row.currency);
      if (rate)
        fx = bankFxCost({
          original: c.amount,
          originalCurrency: c.currency,
          charged: r.row.amount,
          rowCurrency: r.row.currency,
          ecbRate: rate.rate.toFixed(6),
          rateDate: rate.rateDate,
        });
    }
    rows.push({
      id: r.row.id,
      group: reconcileGroup(r),
      inbox: r,
      partner,
      category,
      twins: twins.get(r.row.id) ?? [],
      fx,
    });
  }

  return {
    month: shown,
    previous: shown > overview.from ? banking.addMonths(shown, -1) : null,
    next: shown < thisMonth ? banking.addMonths(shown, 1) : null,
    progress: { justified: m?.justified ?? 0, toJustify: m?.toJustify ?? 0 },
    rows,
    done: await doneToday(tx, today),
  };
}

/** Today's links from a bank row (US3), newest first — the Stockholm day of `created_at`. */
export async function doneToday(
  tx: TransactionClient,
  today: string,
  limit = 50,
): Promise<DoneLink[]> {
  const links = await tx.link.findMany({
    where: {
      fromType: "bank_transaction",
      kind: { in: [...ALLOCATING_KINDS] },
      createdAt: { gte: new Date(`${addDays(today, -1)}T12:00:00Z`) },
    },
    orderBy: { createdAt: "desc" },
    take: limit * 2,
  });
  const bank = getLinkable("bank_transaction");
  const out: DoneLink[] = [];
  for (const l of links) {
    if (stockholmDay(l.createdAt) !== today || out.length >= limit) continue;
    const row = await bank?.summary(tx, l.fromId);
    const target = await getLinkable(l.toType as LinkEndpoint["type"])?.summary(tx, l.toId);
    out.push({
      linkId: l.id,
      bankTransactionId: l.fromId,
      rowLabel: row?.label ?? "",
      targetLabel: target?.label ?? "",
      amount: l.allocatedAmount?.toFixed(2) ?? null,
      currency: l.currency,
      at: l.createdAt.toISOString(),
    });
  }
  return out;
}

// --- the write ---

export type AcceptMatchInput = {
  bankTransactionId: string;
  to: LinkEndpoint;
  allocatedAmount?: string | null;
  /** the owner confirmed or picked it on the stage — omitted when the row or the candidate already carries one */
  partnerId?: string | null;
  basCode?: string | null;
};

/**
 * FR-002: the candidate applied and the unsure fields confirmed, one transaction — `applySuggestion`, then
 * `banking.categorise` with only what the owner set. A refused link returns its error; a refused row throws a
 * `RollbackError` so the link goes with it.
 */
export async function acceptMatch(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: AcceptMatchInput,
): Promise<ServiceResult<LinkDto>> {
  const link = await applySuggestion(tx, caller, audit, {
    bankTransactionId: input.bankTransactionId,
    to: input.to,
    allocatedAmount: input.allocatedAmount ?? null,
  });
  if (link.error) return link;
  const facts = {
    ...(input.partnerId ? { partnerId: input.partnerId } : {}),
    ...(input.basCode ? { basCode: input.basCode } : {}),
  };
  if (Object.keys(facts).length > 0) {
    const r = await banking.categorise(tx, caller, audit, input.bankTransactionId, facts);
    // the link is written already: a refused row must take it back with it (the action rolls the transaction back)
    if (r.error) throw new RollbackError({ ...r.error, message: `row: ${r.error.message}` });
  }
  return link;
}
