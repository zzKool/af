// Suggestions (specs/linking/spec.md FR-003 – FR-005): the generic finder over the registered linkables, the
// scorer run in both directions, apply / bulk apply, the "Link to…" search. Reads other modules only through
// their `Linkable` (facts, candidates, search) — the linking module never touches another module's tables.
import { Prisma } from "@/generated/prisma/client";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { settlementTolerance } from "@/kernel/money/settlement";
import { ALLOCATING_KINDS, isKindAllowed } from "./kinds";
import { getLinkable, listLinkableTypes } from "./linkable";
import { createLink } from "./linking";
import { AMBIGUITY_GAP, type RowFacts, rank, scoreMatch } from "./scoring";
import type {
  BulkApplyResult,
  EntityFacts,
  FlowDirection,
  LinkableType,
  LinkDto,
  LinkEndpoint,
  Suggestion,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** Entity types a bank row of each direction can justify (the kinds matrix narrows it further). */
export const JUSTIFIABLE: Record<FlowDirection, readonly LinkableType[]> = {
  incoming: ["invoice"],
  outgoing: ["supplier_invoice", "expense", "invoice", "document"],
};
/** The window around the row's booking date in which an entity's date may fall (harvest R3; expenses lag). */
export const DATE_WINDOW_DAYS: Partial<Record<LinkableType, number>> = { expense: 10 };
export const DEFAULT_WINDOW_DAYS = 5;
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

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Σ allocations per entity id on one side of the link table (allocating kinds only). */
async function allocatedBy(
  tx: TransactionClient,
  side: "to" | "from",
  type: LinkableType,
  ids: readonly string[],
): Promise<Map<string, Dec>> {
  const out = new Map<string, Dec>();
  if (ids.length === 0) return out;
  const rows = await tx.link.findMany({
    where: {
      kind: { in: [...ALLOCATING_KINDS] },
      allocatedAmount: { not: null },
      ...(side === "to"
        ? { toType: type, toId: { in: [...ids] } }
        : { fromType: type, fromId: { in: [...ids] } }),
    },
    select: { toId: true, fromId: true, allocatedAmount: true },
  });
  for (const r of rows) {
    const id = side === "to" ? r.toId : r.fromId;
    out.set(id, (out.get(id) ?? new D(0)).plus(r.allocatedAmount as Dec));
  }
  return out;
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
    const allocated = await allocatedBy(
      tx,
      side,
      type,
      list.map((f) => f.id),
    );
    for (const f of list) {
      const open = new D(f.amount).abs().minus(allocated.get(f.id) ?? new D(0));
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

function toSuggestion(
  row: RowFacts,
  rowRemaining: string,
  candidate: EntityFacts,
): Suggestion | null {
  const m = scoreMatch(row, candidate);
  if (!m) return null;
  const allocation = m.crossCurrency
    ? null
    : D.min(new D(rowRemaining), new D(candidate.remaining)).toFixed(2);
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
  const raw: Omit<EntityFacts, "remaining">[] = [];
  for (const type of JUSTIFIABLE[rowEntity.direction]) {
    const linkable = getLinkable(type);
    if (!linkable?.candidates || !isKindAllowed("justifies", "bank_transaction", type)) continue;
    const days = DATE_WINDOW_DAYS[type] ?? DEFAULT_WINDOW_DAYS;
    raw.push(
      ...(await linkable.candidates(tx, {
        direction: rowEntity.direction,
        dateFrom: shiftDate(rowEntity.date, -days),
        dateTo: shiftDate(rowEntity.date, days),
        limit: CANDIDATES_PER_TYPE,
      })),
    );
  }
  const candidates = await withRemaining(tx, "to", raw);
  const scored = candidates
    .map((c) => toSuggestion(row, rowEntity.remaining, c))
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
  const days = DATE_WINDOW_DAYS[endpoint.type] ?? DEFAULT_WINDOW_DAYS;
  const rowsRaw = await bank.candidates(tx, {
    direction: entity.direction,
    dateFrom: shiftDate(entity.date, -days),
    dateTo: shiftDate(entity.date, days),
    limit: CANDIDATES_PER_TYPE,
  });
  const rows = await withRemaining(tx, "from", rowsRaw);
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
      );
      if (!m) return null;
      const allocation = m.crossCurrency
        ? null
        : D.min(new D(r.remaining), new D(entity.remaining)).toFixed(2);
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
 * Apply one suggestion (FR-004): the `justifies` link with the allocation in the target's currency. A
 * cross-currency target is refused here — supplier invoices and expenses have their own attach path (the bank
 * row's amount becomes their paid amount, D-g / D26) and a client invoice is never paid in another currency (B9).
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
  const targetFacts = await linkable.facts(tx, input.to.id);
  if (!targetFacts) return { error: notFound(`${input.to.type} ${input.to.id} not found`) };
  const [target] = await withRemaining(tx, "to", [targetFacts], true);
  if (!target) return { error: notFound(`${input.to.type} ${input.to.id} not found`) };
  // a document without an amount (no OCR total) is linked without an allocation
  if (new D(target.amount).lte(0)) {
    return createLink(tx, caller, audit, {
      from: { type: "bank_transaction", id: input.bankTransactionId },
      to: input.to,
      kind: "justifies",
      note: input.note ?? null,
    });
  }
  if (target.currency !== facts.currency) {
    return {
      error: violation(
        `${target.label} is in ${target.currency}, the bank row in ${facts.currency} — ${
          input.to.type === "invoice"
            ? "a client invoice is paid in its own currency"
            : "attach the bank row from the entity's panel instead"
        }`,
      ),
    };
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
      skip("CURRENCY_MISMATCH", `${top.candidate.label} is in ${top.candidate.currency}`);
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
