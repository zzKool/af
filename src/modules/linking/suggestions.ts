// Suggestions (specs/linking/spec.md FR-003 – FR-005): the generic finder over the registered linkables, the
// scorer run in both directions, apply / bulk apply, the "Link to…" search. Reads other modules only through
// their `Linkable` (facts, candidates, search) — the linking module never touches another module's tables.
import { Prisma } from "@/generated/prisma/client";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { settlementTolerance } from "@/kernel/money/settlement";
import * as rates from "@/modules/rates";
import { ALLOCATING_KINDS, isKindAllowed } from "./kinds";
import { getLinkable, listLinkableTypes } from "./linkable";
import { createLink, linkById } from "./linking";
import { memoryForKeys, rememberedPartners } from "./memory";
import { rowRemaining, rowUsage } from "./queries";
import {
  AMBIGUITY_GAP,
  CROSS_CURRENCY_TOLERANCE,
  type Memory,
  proposedAllocation,
  type RowFacts,
  rank,
  referenceTokens,
  scoreMatch,
} from "./scoring";
import type {
  BulkApplyResult,
  CandidateQuery,
  EntityFacts,
  FlowDirection,
  LinkableType,
  LinkDto,
  LinkEndpoint,
  Suggestion,
} from "./types";
import { DATED_WINDOW_DAYS, inWindow, paymentWindow } from "./window";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** Entity types a bank row of each direction can justify (the kinds matrix narrows it further). */
export const JUSTIFIABLE: Record<FlowDirection, readonly LinkableType[]> = {
  // an incoming row: a client paying an invoice, or a vendor refunding — its credit note is the proof (F116 FR-006)
  incoming: ["invoice", "document"],
  outgoing: ["supplier_invoice", "expense", "invoice", "document"],
};
export const CANDIDATES_PER_TYPE = 50;
export const SUGGESTIONS_SHOWN = 5;

const violation = (message: string) => ({
  code: "BUSINESS_RULE_VIOLATION" as const,
  message,
  retryable: false,
});
const notFound = (what: string) => ({
  code: "NOT_FOUND" as const,
  message: what,
  retryable: false,
});

/** Σ allocations ONTO each entity id (allocating kinds only), in the target's currency. */
async function allocatedOnto(
  tx: TransactionClient,
  type: LinkableType,
  ids: readonly string[],
): Promise<Map<string, Dec>> {
  const out = new Map<string, Dec>();
  if (ids.length === 0) return out;
  const rows = await tx.link.findMany({
    where: {
      kind: { in: [...ALLOCATING_KINDS] },
      allocatedAmount: { not: null },
      toType: type,
      toId: { in: [...ids] },
    },
    select: { toId: true, allocatedAmount: true },
  });
  for (const r of rows) {
    out.set(r.toId, (out.get(r.toId) ?? new D(0)).plus(r.allocatedAmount as Dec));
  }
  return out;
}

/**
 * A candidate in another currency that carries no base (a receipt — OCR read an amount and a currency, nothing
 * converted it) gets one for the comparison (F116, audit B6): its amount at the ECB rate of its date into the row's
 * currency, then at the row's own rate into base. Nothing is stored; no base-currency code is needed.
 */
export async function withForeignBases<T extends Omit<EntityFacts, "remaining">>(
  tx: TransactionClient,
  row: { amount: string; currency: string | null; amountBase: string | null },
  candidates: readonly T[],
): Promise<T[]> {
  if (!row.currency || !row.amountBase || new D(row.amount).isZero()) return [...candidates];
  const rowRate = new D(row.amountBase).abs().div(new D(row.amount).abs());
  const cache = new Map<string, Dec | null>();
  const out: T[] = [];
  for (const c of candidates) {
    if (
      c.amountBase !== null ||
      !c.currency ||
      c.currency === row.currency ||
      new D(c.amount).lte(0)
    ) {
      out.push(c);
      continue;
    }
    const k = `${c.date}|${c.currency}|${row.currency}`;
    if (!cache.has(k)) {
      const r = await rates.rateToBase(tx, c.date, c.currency, row.currency);
      cache.set(k, r ? new D(r.rate) : null);
    }
    const rate = cache.get(k);
    out.push(rate ? { ...c, amountBase: new D(c.amount).mul(rate).mul(rowRate).toFixed(2) } : c);
  }
  return out;
}

/** One fact per entity: a candidate found by its window, its number and its partner comes back once. */
export function dedupe<T extends { type: string; id: string }>(facts: readonly T[]): T[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = `${f.type}:${f.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Facts + what is still open on them; entities with nothing left (within the tolerance) are dropped. */
export async function withRemaining(
  tx: TransactionClient,
  side: "to" | "from",
  facts: Omit<EntityFacts, "remaining">[],
  keepSettled = false,
): Promise<EntityFacts[]> {
  const byType = new Map<LinkableType, Omit<EntityFacts, "remaining">[]>();
  for (const f of facts) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
  const out: EntityFacts[] = [];
  for (const [type, list] of byType) {
    const ids = list.map((f) => f.id);
    // a bank row gives from itself (its cross-currency links count by their base share, F114); an entity receives
    const usage = side === "from" ? await rowUsage(tx, ids) : null;
    const allocated = side === "to" ? await allocatedOnto(tx, type, ids) : null;
    for (const f of list) {
      const open = usage
        ? rowRemaining({ ...f, currency: f.currency ?? "" }, usage.get(f.id))
        : new D(f.amount).abs().minus(allocated?.get(f.id) ?? new D(0));
      if (!keepSettled && open.lte(settlementTolerance(f.amount))) continue;
      out.push({ ...f, remaining: open.lt(0) ? "0.00" : open.toFixed(2) });
    }
  }
  return out;
}

/** The bank row with what is left to allocate from it; null when it does not exist. */
export async function rowFacts(
  tx: TransactionClient,
  bankTransactionId: string,
): Promise<(EntityFacts & { row: RowFacts }) | null> {
  const bank = getLinkable("bank_transaction");
  if (!bank?.facts) return null;
  const facts = await bank.facts(tx, bankTransactionId);
  if (!facts) return null;
  const [withOpen] = await withRemaining(tx, "from", [facts], true);
  if (!withOpen) return null;
  return {
    ...withOpen,
    row: {
      amount: withOpen.amount,
      currency: withOpen.currency,
      amountBase: withOpen.amountBase,
      date: withOpen.date,
      texts: withOpen.texts,
    },
  };
}

/**
 * Whether a candidate belongs with a row (F116): inside its payment window, or its number is in the row's text, or
 * its partner is one the row's counterparty was linked to before — the last two whatever the date.
 */
export function belongs(
  rowDate: string,
  tokens: ReadonlySet<string>,
  memory: Memory | undefined,
  c: Pick<EntityFacts, "type" | "date" | "dueDate" | "reference" | "partnerId">,
): boolean {
  if (inWindow(rowDate, c)) return true;
  if (c.reference && tokens.has(c.reference.toUpperCase())) return true;
  return !!c.partnerId && !!memory?.has(c.partnerId);
}

/** The candidate query for rows booked in [from, to]: the dated span, the terms span, numbers and remembered partners. */
export function candidateQuery(
  direction: FlowDirection,
  bookedFrom: string,
  bookedTo: string,
  references: readonly string[],
  partnerIds: readonly string[],
  limit: number,
): CandidateQuery {
  return {
    direction,
    dateFrom: addDays(bookedFrom, -DATED_WINDOW_DAYS),
    dateTo: addDays(bookedTo, DATED_WINDOW_DAYS),
    bookedFrom,
    bookedTo,
    references,
    partnerIds,
    limit,
  };
}

function toSuggestion(
  row: RowFacts,
  rowRemaining: string,
  candidate: EntityFacts,
  memory?: Memory,
): Suggestion | null {
  const m = scoreMatch(row, candidate, memory);
  if (!m) return null;
  const allocation = proposedAllocation(
    m,
    { remaining: rowRemaining, currency: row.currency },
    candidate,
  );
  return { ...m, candidate, allocation };
}

/** The top candidates a bank row could justify (US1). Empty when the row has nothing left to allocate. */
export async function suggestionsForTransaction(
  tx: TransactionClient,
  bankTransactionId: string,
  limit = SUGGESTIONS_SHOWN,
): Promise<ServiceResult<{ row: EntityFacts; suggestions: Suggestion[] }>> {
  const facts = await rowFacts(tx, bankTransactionId);
  if (!facts) return { error: notFound(`Bank transaction ${bankTransactionId} not found`) };
  const { row, ...rowEntity } = facts;
  if (new D(rowEntity.remaining).lte(0)) return { data: { row: rowEntity, suggestions: [] } };
  const key = rowEntity.counterpartyKey ?? null;
  const memory = key ? (await memoryForKeys(tx, [key])).get(key) : undefined;
  const references = referenceTokens(rowEntity.texts);
  const tokens = new Set(references.map((t) => t.toUpperCase()));
  const query = candidateQuery(
    rowEntity.direction,
    rowEntity.date,
    rowEntity.date,
    references,
    rememberedPartners(memory),
    CANDIDATES_PER_TYPE,
  );
  const raw: Omit<EntityFacts, "remaining">[] = [];
  for (const type of JUSTIFIABLE[rowEntity.direction]) {
    const linkable = getLinkable(type);
    if (!linkable?.candidates || !isKindAllowed("justifies", "bank_transaction", type)) continue;
    raw.push(...(await linkable.candidates(tx, query)));
  }
  const candidates = (
    await withRemaining(tx, "to", await withForeignBases(tx, rowEntity, dedupe(raw)))
  ).filter((c) => belongs(rowEntity.date, tokens, memory, c));
  const scored = candidates
    .map((c) => toSuggestion(row, rowEntity.remaining, c, memory))
    .filter((s): s is Suggestion => s !== null);
  return { data: { row: rowEntity, suggestions: rank(scored).slice(0, limit) } };
}

/** The bank rows that could pay an entity (US1-6) — the same scorer the other way round. */
export async function suggestionsForEntity(
  tx: TransactionClient,
  endpoint: LinkEndpoint,
  limit = SUGGESTIONS_SHOWN,
): Promise<ServiceResult<{ entity: EntityFacts; suggestions: Suggestion[] }>> {
  const linkable = getLinkable(endpoint.type);
  const bank = getLinkable("bank_transaction");
  if (!linkable?.facts) return { error: violation(`${endpoint.type} has no facts for matching`) };
  if (!bank?.candidates) return { error: violation("bank_transaction has no candidates") };
  const facts = await linkable.facts(tx, endpoint.id);
  if (!facts) return { error: notFound(`${endpoint.type} ${endpoint.id} not found`) };
  const [entity] = await withRemaining(tx, "to", [facts], true);
  if (!entity || new D(entity.remaining).lte(0)) {
    return { data: { entity: entity ?? { ...facts, remaining: "0.00" }, suggestions: [] } };
  }
  // the rows booked inside the entity's payment window (F116: an invoice on terms is paid by its due date)
  const window = paymentWindow(entity);
  const rowsRaw = await bank.candidates(tx, {
    direction: entity.direction,
    dateFrom: window.from,
    dateTo: window.to,
    limit: CANDIDATES_PER_TYPE,
  });
  const rows = await withRemaining(tx, "from", rowsRaw);
  const memories = await memoryForKeys(
    tx,
    rows.map((r) => r.counterpartyKey),
  );
  const scored = rows
    .map((r) => {
      const m = scoreMatch(
        {
          amount: r.amount,
          currency: r.currency,
          amountBase: r.amountBase,
          date: r.date,
          texts: r.texts,
        },
        entity,
        r.counterpartyKey ? memories.get(r.counterpartyKey) : undefined,
      );
      if (!m) return null;
      const allocation = proposedAllocation(m, r, entity);
      return { ...m, candidate: r, allocation } satisfies Suggestion;
    })
    .filter((s): s is Suggestion => s !== null);
  return { data: { entity, suggestions: rank(scored).slice(0, limit) } };
}

/** "Link to…": every registered type's search, labels first (US2). */
export async function searchLinkables(
  tx: TransactionClient,
  q: string,
  types?: readonly LinkableType[],
  limit = 20,
): Promise<EntityFacts[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const out: Omit<EntityFacts, "remaining">[] = [];
  for (const type of types ?? listLinkableTypes()) {
    const linkable = getLinkable(type);
    if (!linkable?.search) continue;
    out.push(...(await linkable.search(tx, term, limit)));
  }
  return withRemaining(tx, "to", out, true);
}

export type ApplyInput = {
  bankTransactionId: string;
  to: LinkEndpoint;
  /** in the target currency; defaults to min(remaining on the row, remaining on the target) */
  allocatedAmount?: string | null;
  note?: string | null;
};

/**
 * Apply one suggestion (FR-004): the `justifies` link with the allocation in the target's currency — in another
 * currency too (F116 FR-005, D60: `crossAllocation`, the row's base on the link). An entity that writes its own
 * payments (a supplier invoice, an expense — D37) is paid through its module's `pay` (F124 (3), 2026-10-29): one
 * click, the module's validations, the link it wrote returned — `createLink` still refuses the generic path.
 */
export async function applySuggestion(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: ApplyInput,
): Promise<ServiceResult<LinkDto>> {
  const facts = await rowFacts(tx, input.bankTransactionId);
  if (!facts) return { error: notFound(`Bank transaction ${input.bankTransactionId} not found`) };
  const linkable = getLinkable(input.to.type);
  if (!linkable?.facts) return { error: violation(`${input.to.type} cannot be linked this way`) };
  if (linkable.pay) {
    const paid = await linkable.pay(tx, caller, audit, {
      id: input.to.id,
      bankTransactionId: input.bankTransactionId,
      ...(input.allocatedAmount?.trim() ? { amount: input.allocatedAmount.trim() } : {}),
    });
    if (paid.error) return { error: paid.error };
    const link = await linkById(tx, paid.data.linkId);
    return link ? { data: link } : { error: notFound(`Link ${paid.data.linkId} not found`) };
  }
  const targetFacts = await linkable.facts(tx, input.to.id);
  if (!targetFacts) return { error: notFound(`${input.to.type} ${input.to.id} not found`) };
  const [target] = await withRemaining(tx, "to", [targetFacts], true);
  if (!target) return { error: notFound(`${input.to.type} ${input.to.id} not found`) };
  // a document without an amount (no OCR total) or whose currency was not read (F61-b) is linked without an
  // allocation — there is nothing to allocate in a currency nobody knows
  if (new D(target.amount).lte(0) || target.currency === null) {
    return createLink(tx, caller, audit, {
      from: { type: "bank_transaction", id: input.bankTransactionId },
      to: input.to,
      kind: "justifies",
      note: input.note ?? null,
    });
  }
  if (target.currency !== facts.currency) {
    // F116 FR-005, D60: a cross-currency pair applies like any other — the allocation in the entity's currency,
    // what the row gave in base on the link, the FX difference derived
    const [based] = await withForeignBases(tx, facts, [target]);
    const cross = crossAllocation(facts, based ?? target, input.allocatedAmount ?? null);
    if ("error" in cross) return { error: violation(cross.error) };
    return createLink(tx, caller, audit, {
      from: { type: "bank_transaction", id: input.bankTransactionId },
      to: input.to,
      kind: "justifies",
      allocatedAmount: cross.amount,
      currency: target.currency,
      allocatedBase: cross.base,
      note: input.note ?? null,
    });
  }
  const proposed = D.min(new D(facts.remaining), new D(target.remaining));
  const allocation = input.allocatedAmount ? new D(input.allocatedAmount) : proposed;
  if (allocation.lte(0)) {
    return {
      error: violation(
        new D(facts.remaining).lte(0)
          ? `${facts.label} has nothing left to allocate`
          : `${target.label} has nothing left open`,
      ),
    };
  }
  return createLink(tx, caller, audit, {
    from: { type: "bank_transaction", id: input.bankTransactionId },
    to: input.to,
    kind: "justifies",
    allocatedAmount: allocation.toFixed(2),
    currency: target.currency,
    note: input.note ?? null,
  });
}

/** Within this share of the entity's open base, the row pays it whole (the card's FX margin, D67's 6 %). */
const CROSS_WHOLE = new D(CROSS_CURRENCY_TOLERANCE);

/**
 * What a row in one currency allocates onto an entity in another (pure): the entity's open amount when the row's
 * remaining base covers its open base within 6 % — the row's whole remaining base on the link, or only the entity's
 * open base when the row is larger still (it pays something else too); else the share the row's base buys, and the
 * row's base all of it. A typed amount is taken as is; the base then follows the share.
 */
export function crossAllocation(
  row: Pick<EntityFacts, "amount" | "amountBase" | "remaining" | "label">,
  entity: Pick<EntityFacts, "amount" | "amountBase" | "remaining" | "label" | "currency">,
  typed: string | null,
): { amount: string; base: string } | { error: string } {
  if (!row.amountBase || !entity.amountBase || new D(entity.amount).lte(0)) {
    return { error: `${entity.label}: no rate to compare ${entity.currency} with the bank row` };
  }
  const rowBase = new D(row.amountBase)
    .abs()
    .mul(new D(row.remaining))
    .div(new D(row.amount).abs());
  const openBase = new D(entity.amountBase)
    .abs()
    .mul(new D(entity.remaining))
    .div(new D(entity.amount));
  const open = new D(entity.remaining);
  if (rowBase.lte(0)) return { error: `${row.label} has nothing left to allocate` };
  if (open.lte(0) || openBase.lte(0)) return { error: `${entity.label} has nothing left open` };
  if (typed) {
    const amount = new D(typed);
    const base = D.min(rowBase, openBase.mul(amount).div(open));
    return { amount: amount.toFixed(2), base: base.toFixed(2) };
  }
  const share = rowBase.div(openBase);
  if (share.gte(new D(1).minus(CROSS_WHOLE))) {
    const base = share.gt(new D(1).plus(CROSS_WHOLE)) ? openBase : rowBase;
    return { amount: open.toFixed(2), base: base.toFixed(2) };
  }
  return {
    amount: open.mul(share).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
    base: rowBase.toFixed(2),
  };
}

/** Apply the top HIGH candidate of each row, with the skip reasons of harvest R18 (US3). */
export async function bulkApplyHigh(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  bankTransactionIds: readonly string[],
): Promise<BulkApplyResult> {
  const result: BulkApplyResult = { applied: [], skipped: [], failed: [] };
  for (const bankTransactionId of bankTransactionIds) {
    const r = await suggestionsForTransaction(tx, bankTransactionId);
    if (r.error) {
      result.failed.push({ bankTransactionId, message: r.error.message });
      continue;
    }
    const { row, suggestions } = r.data;
    const skip = (reason: BulkApplyResult["skipped"][number]["reason"], detail: string) =>
      result.skipped.push({ bankTransactionId, reason, detail });
    if (new D(row.remaining).lte(0)) {
      skip("ALREADY_LINKED", "Nothing left to allocate on the row");
      continue;
    }
    const [top, second] = suggestions;
    if (!top) {
      skip("NO_CANDIDATES", "No candidate in the window");
      continue;
    }
    if (top.confidence !== "HIGH") {
      skip("LOW_CONFIDENCE", `Best candidate is ${top.confidence} confidence`);
      continue;
    }
    if (second?.confidence === "HIGH" && top.score - second.score < AMBIGUITY_GAP) {
      skip("AMBIGUOUS", `Top 2 candidates have similar scores (${top.score} vs ${second.score})`);
      continue;
    }
    if (top.crossCurrency || top.allocation === null) {
      skip(
        "CURRENCY_MISMATCH",
        top.candidate.currency === null
          ? `${top.candidate.label}: currency not read — link it from the row`
          : `${top.candidate.label} is in ${top.candidate.currency}`,
      );
      continue;
    }
    if (new D(top.allocation).lte(0)) {
      skip("OVER_ALLOCATION", "Nothing left to allocate");
      continue;
    }
    const applied = await applySuggestion(tx, caller, audit, {
      bankTransactionId,
      to: { type: top.candidate.type, id: top.candidate.id },
      allocatedAmount: top.allocation,
      note: "Applied from the inbox (confidence: HIGH)",
    });
    if (applied.error) result.failed.push({ bankTransactionId, message: applied.error.message });
    else
      result.applied.push({
        bankTransactionId,
        to: { type: top.candidate.type, id: top.candidate.id },
        allocatedAmount: top.allocation,
      });
  }
  return result;
}
