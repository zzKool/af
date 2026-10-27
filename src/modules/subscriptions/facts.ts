// The read side (F94 FR-004, FR-007): one pass for a set of subscriptions — their prices and pauses, the entities
// attributed to them, the bank rows and inbox documents of the union of their windows, the ECB rates the
// cross-currency compares need — then the pure functions do the rest. Nothing is written, nothing stored.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as partners from "@/modules/partners";
import * as rates from "@/modules/rates";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { attribute } from "./attribution";
import {
  type MatchDocument,
  type MatchRow,
  type MatchSubscription,
  markAmbiguity,
  matchDocument,
  matchRow,
  type RateOf,
} from "./matcher";
import { periodsOf } from "./periods";
import { periodState } from "./state";
import { occurrenceIds, toPauseDto, toPriceDto, toSubscriptionDto } from "./subscriptions";
import type {
  DocumentMatch,
  EntityFact,
  PauseDto,
  Period,
  PeriodView,
  PriceDto,
  RowMatch,
  SubscriptionDto,
} from "./types";

export type LoadedSubscription = {
  subscription: SubscriptionDto;
  prices: PriceDto[];
  pauses: PauseDto[];
  partnerName: string | null;
  partnerVatNumber: string | null;
  groupLabel: string;
  payerLabel: string;
  /** the payer is a private source */
  privatePaid: boolean;
  bankAccountId: string | null;
  /** oldest first */
  periods: PeriodView[];
};

const key = (subscriptionId: string, date: string) => `${subscriptionId}|${date}`;

function toEntityFact(
  type: "expense" | "supplier_invoice",
  r:
    | Awaited<ReturnType<typeof expenses.expenseRowsByIds>>[number]
    | Awaited<ReturnType<typeof supplierInvoices.supplierInvoiceRowsByIds>>[number],
): EntityFact {
  if (type === "expense") {
    const e = r as Awaited<ReturnType<typeof expenses.expenseRowsByIds>>[number];
    return {
      type,
      id: e.id,
      key: e.key,
      date: e.date,
      amount: e.amount,
      currency: e.currency,
      hasDocument: e.hasDocument,
      needsPayment: e.payerKind === "bank_account",
      paid: e.status === "paid",
      overdue: false,
      status: e.status,
    };
  }
  const s = r as Awaited<ReturnType<typeof supplierInvoices.supplierInvoiceRowsByIds>>[number];
  return {
    type,
    id: s.id,
    key: s.key,
    date: s.invoiceDate,
    amount: s.amountTotal,
    currency: s.currency,
    hasDocument: s.hasDocument,
    needsPayment: true,
    paid: s.status === "paid",
    overdue: s.status === "overdue",
    status: s.status,
  };
}

/** Load and compute every given subscription (all of the tenant's when `ids` is omitted). */
export async function loadSubscriptions(
  tx: TransactionClient,
  caller: CallerIdentity,
  today: string,
  ids?: readonly string[],
): Promise<LoadedSubscription[]> {
  const rows = await tx.subscription.findMany({
    where: ids ? { id: { in: [...ids] } } : {},
    include: { prices: true, pauses: true },
    orderBy: [{ name: "asc" }],
  });
  if (rows.length === 0) return [];

  // the references, through their owners
  const sources = new Map((await banking.payerAccounts(tx)).map((s) => [s.id, s]));
  const groups = new Map(
    (await expenses.listGroups(tx)).map((g) => [g.id, expenses.groupLabel(g)]),
  );
  const partnerFacts = new Map<string, { name: string; vatNumber: string | null }>();
  for (const pid of new Set(rows.map((r) => r.partnerId))) {
    const p = await partners.getPartner(tx, pid);
    if (p.data) partnerFacts.set(pid, { name: p.data.name, vatNumber: p.data.vatNumber });
  }

  const subs = rows.map((r) => {
    const subscription = toSubscriptionDto(r);
    const prices = r.prices.map(toPriceDto).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const pauses = r.pauses.map(toPauseDto).sort((a, b) => a.fromDate.localeCompare(b.fromDate));
    const source = sources.get(r.paidFromAccountId);
    return {
      subscription,
      prices,
      pauses,
      partnerName: partnerFacts.get(r.partnerId)?.name ?? null,
      partnerVatNumber: partnerFacts.get(r.partnerId)?.vatNumber ?? null,
      groupLabel: groups.get(r.groupId) ?? "",
      payerLabel: source?.label ?? "",
      privatePaid: source?.kind === "private",
      bankAccountId: source?.kind === "bank_account" ? source.id : null,
      periods: periodsOf({ ...subscription, prices, pauses }, today),
    };
  });

  // the attributed entities, read through their modules
  const occurrences = await occurrenceIds(
    tx,
    rows.map((r) => r.id),
  );
  const expenseRows = await expenses.expenseRowsByIds(
    tx,
    occurrences.filter((o) => o.type === "expense").map((o) => o.id),
  );
  const siRows = await supplierInvoices.supplierInvoiceRowsByIds(
    tx,
    occurrences.filter((o) => o.type === "supplier_invoice").map((o) => o.id),
    today,
  );
  const facts = new Map<string, EntityFact>([
    ...expenseRows.map((e) => [e.id, toEntityFact("expense", e)] as const),
    ...siRows.map((s) => [s.id, toEntityFact("supplier_invoice", s)] as const),
  ]);
  const entitiesOf = new Map<string, Map<number, EntityFact[]>>();
  for (const s of subs) {
    const mine = occurrences
      .filter((o) => o.subscriptionId === s.subscription.id)
      .flatMap((o) => {
        const f = facts.get(o.id);
        return f ? [f] : [];
      });
    entitiesOf.set(
      s.subscription.id,
      attribute(
        s.periods.map((p) => p.date),
        mine,
      ),
    );
  }

  // which periods look for a row / a document — only those that can still take one
  type Need = { sub: (typeof subs)[number]; period: Period; index: number; entity?: EntityFact };
  const rowNeeds: Need[] = [];
  const docNeeds: Need[] = [];
  for (const s of subs) {
    s.periods.forEach((period, index) => {
      if (period.receiptWindow.from > today) return; // too early for anything to have arrived
      const entity = entitiesOf.get(s.subscription.id)?.get(index)?.[0];
      if (period.skipped && !entity) return;
      const wantsRow =
        s.subscription.becomes === "expense" &&
        s.bankAccountId !== null &&
        (!entity || (entity.needsPayment && !entity.paid));
      const wantsDoc = !entity || !entity.hasDocument;
      if (wantsRow && period.rowWindow.from <= today)
        rowNeeds.push({ sub: s, period, index, entity });
      if (wantsDoc) docNeeds.push({ sub: s, period, index, entity });
    });
  }

  const span = (needs: Need[], w: "rowWindow" | "receiptWindow") =>
    needs.length === 0
      ? null
      : {
          from: needs.reduce((m, n) => (n.period[w].from < m ? n.period[w].from : m), "9999-12-31"),
          to: needs.reduce((m, n) => (n.period[w].to > m ? n.period[w].to : m), "0000-01-01"),
        };
  const rowSpan = span(rowNeeds, "rowWindow");
  const docSpan = span(docNeeds, "receiptWindow");
  const accountIds = [
    ...new Set(rowNeeds.flatMap((n) => (n.sub.bankAccountId ? [n.sub.bankAccountId] : []))),
  ];
  const windowRows: MatchRow[] = rowSpan
    ? await banking.outgoingRowsInWindow(tx, { bankAccountIds: accountIds, ...rowSpan })
    : [];
  const windowDocs: MatchDocument[] = docSpan
    ? await documents.inboxFinancialFacts(tx, caller, docSpan)
    : [];

  // the rates the cross-currency compares need, fetched once each
  const wanted = new Set<string>();
  for (const n of rowNeeds)
    for (const r of windowRows)
      if (n.period.price && r.currency !== n.period.price.currency)
        wanted.add(`${r.bookingDate}|${n.period.price.currency}|${r.currency}`);
  for (const n of docNeeds)
    for (const d of windowDocs)
      if (n.period.price && d.currency && d.date && d.currency !== n.period.price.currency)
        wanted.add(`${d.date}|${n.period.price.currency}|${d.currency}`);
  const rateCache = new Map<string, string | null>();
  for (const k of wanted) {
    const [date, from, to] = k.split("|") as [string, string, string];
    const r = await rates.rateToBase(tx, date, from, to);
    rateCache.set(k, r ? r.rate.toFixed(6) : null);
  }
  const rateOf: RateOf = (date, from, to) => rateCache.get(`${date}|${from}|${to}`) ?? null;

  const matchSubOf = (s: (typeof subs)[number]): MatchSubscription => ({
    partnerId: s.subscription.partnerId,
    partnerName: s.partnerName,
    partnerVatNumber: s.partnerVatNumber,
    matchText: s.subscription.matchText,
    tolerancePct: s.subscription.tolerancePct,
    basCode: s.subscription.basCode,
    bankAccountId: s.bankAccountId,
  });
  const rowOffers: { periodKey: string; itemId: string; offer: Omit<RowMatch, "ambiguous"> }[] = [];
  for (const n of rowNeeds) {
    const ms = matchSubOf(n.sub);
    for (const r of windowRows) {
      const m = matchRow(n.period, ms, r, rateOf);
      if (m)
        rowOffers.push({
          periodKey: key(n.sub.subscription.id, n.period.date),
          itemId: r.id,
          offer: m,
        });
    }
  }
  const docOffers: {
    periodKey: string;
    itemId: string;
    offer: Omit<DocumentMatch, "ambiguous">;
  }[] = [];
  for (const n of docNeeds) {
    const ms = matchSubOf(n.sub);
    for (const d of windowDocs) {
      const m = matchDocument(n.period, ms, d, rateOf);
      if (m)
        docOffers.push({
          periodKey: key(n.sub.subscription.id, n.period.date),
          itemId: d.id,
          offer: m,
        });
    }
  }
  const rowsByPeriod = markAmbiguity<RowMatch>(rowOffers);
  const docsByPeriod = markAmbiguity<DocumentMatch>(docOffers);

  return subs.map((s) => ({
    ...s,
    periods: s.periods.map((period, index): PeriodView => {
      const k = key(s.subscription.id, period.date);
      const entities = entitiesOf.get(s.subscription.id)?.get(index) ?? [];
      const rowsOffered = rowsByPeriod.get(k) ?? [];
      const docsOffered = docsByPeriod.get(k) ?? [];
      const { state, marks } = periodState({
        period,
        becomes: s.subscription.becomes,
        privatePaid: s.privatePaid,
        entities,
        rowOffered: rowsOffered.length > 0,
        documentOffered: docsOffered.length > 0,
        today,
      });
      return { ...period, state, marks, entities, rows: rowsOffered, documents: docsOffered };
    }),
  }));
}
