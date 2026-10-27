// The inbox read model (specs/linking/spec.md US3): every main-account row that is neither linked, transferred
// nor "no document needed", each with its top candidates — scored in one pass over candidate pools fetched once
// per type for the whole date span, not row by row.
import { Prisma } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import { isKindAllowed } from "./kinds";
import { getLinkable } from "./linkable";
import { memoryForKeys, rememberedPartners } from "./memory";
import { proposedAllocation, rank, referenceTokens, scoreMatch } from "./scoring";
import {
  belongs,
  CANDIDATES_PER_TYPE,
  candidateQuery,
  dedupe,
  JUSTIFIABLE,
  SUGGESTIONS_SHOWN,
  withRemaining,
} from "./suggestions";
import type { Confidence, EntityFacts, FlowDirection, Suggestion } from "./types";

const D = Prisma.Decimal;

export type InboxRow = {
  row: EntityFacts;
  accountLabel: string;
  state: "open" | "partial";
  basCode: string | null;
  basLabel: string | null;
  top: Suggestion | null;
  suggestions: Suggestion[];
};

export const INBOX_LIMIT = 300;
const TIER: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** The rows needing attention with their candidates, best first (HIGH > MEDIUM > LOW > none, then newest). */
export async function inboxRows(tx: TransactionClient, limit = INBOX_LIMIT): Promise<InboxRow[]> {
  // main accounts first, then the page: filtering after paging let newer savings rows crowd main ones out (audit 32)
  const accounts = await banking.listMainAccountIds(tx);
  if (accounts.length === 0) return [];
  const list = await banking.listTransactions(tx, {
    page: 1,
    pageSize: limit,
    sort: [{ col: "bookingDate", dir: "desc" }],
    filters: {
      bankAccountId: { kind: "in", values: accounts },
      state: { kind: "in", values: ["open", "partial"] },
    },
  });
  const candidatesRows = list.rows;
  const bank = getLinkable("bank_transaction");
  if (!bank?.factsMany || candidatesRows.length === 0) return [];
  const facts = await withRemaining(
    tx,
    "from",
    await bank.factsMany(
      tx,
      candidatesRows.map((r) => r.id),
    ),
    true,
  );
  const byId = new Map(facts.map((f) => [f.id, f]));
  const rowsById = new Map(candidatesRows.map((r) => [r.id, r]));

  // the counterparty memory of every row's key, one read (F116)
  const memories = await memoryForKeys(
    tx,
    facts.map((f) => f.counterpartyKey),
  );
  const memoryOf = (f: EntityFacts) =>
    f.counterpartyKey ? memories.get(f.counterpartyKey) : undefined;
  const tokensOf = new Map(
    facts.map((f) => [f.id, new Set(referenceTokens(f.texts).map((t) => t.toUpperCase()))]),
  );

  // one candidate pool per direction × type over the whole span (each row then keeps what belongs with it)
  const pools = new Map<FlowDirection, EntityFacts[]>();
  for (const direction of ["incoming", "outgoing"] as const) {
    const mine = facts.filter((f) => f.direction === direction);
    if (mine.length === 0) continue;
    const dates = mine.map((f) => f.date);
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const query = candidateQuery(
      direction,
      min,
      max,
      [...new Set(mine.flatMap((f) => referenceTokens(f.texts)))].slice(0, 500),
      [...new Set(mine.flatMap((f) => rememberedPartners(memoryOf(f))))],
      CANDIDATES_PER_TYPE * 10,
    );
    const raw: Omit<EntityFacts, "remaining">[] = [];
    for (const type of JUSTIFIABLE[direction]) {
      const linkable = getLinkable(type);
      if (!linkable?.candidates || !isKindAllowed("justifies", "bank_transaction", type)) continue;
      raw.push(...(await linkable.candidates(tx, query)));
    }
    pools.set(direction, await withRemaining(tx, "to", dedupe(raw)));
  }

  const out: InboxRow[] = [];
  for (const r of candidatesRows) {
    const f = byId.get(r.id);
    if (!f) continue;
    const pool = pools.get(f.direction) ?? [];
    const scored: Suggestion[] = [];
    if (new D(f.remaining).gt(0)) {
      const memory = memoryOf(f);
      const tokens = tokensOf.get(f.id) ?? new Set<string>();
      for (const c of pool) {
        if (!belongs(f.date, tokens, memory, c)) continue;
        const m = scoreMatch(
          {
            amount: f.amount,
            currency: f.currency,
            amountBase: f.amountBase,
            date: f.date,
            texts: f.texts,
          },
          c,
          memory,
        );
        if (!m) continue;
        scored.push({
          ...m,
          candidate: c,
          allocation: proposedAllocation(m, f, c),
        });
      }
    }
    const ranked = rank(scored).slice(0, SUGGESTIONS_SHOWN);
    const row = rowsById.get(r.id);
    out.push({
      row: f,
      accountLabel: r.accountLabel,
      state: r.state === "partial" ? "partial" : "open",
      basCode: row?.basCode ?? null,
      basLabel: row?.basLabel ?? null,
      top: ranked[0] ?? null,
      suggestions: ranked,
    });
  }
  return out.sort(
    (a, b) =>
      (a.top ? TIER[a.top.confidence] : 3) - (b.top ? TIER[b.top.confidence] : 3) ||
      b.row.date.localeCompare(a.row.date) ||
      a.row.id.localeCompare(b.row.id),
  );
}

/** Financial documents that became nothing and justify nothing — the inbox's second tab. */
export async function unlinkedDocuments(
  tx: TransactionClient,
  limit = 200,
): Promise<EntityFacts[]> {
  const raw = await documents.unlinkedFinancialDocuments(tx, limit);
  return withRemaining(tx, "to", raw, true);
}
