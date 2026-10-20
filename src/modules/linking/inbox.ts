// The inbox read model (specs/linking/spec.md US3): every main-account row that is neither linked, transferred
// nor "no document needed", each with its top candidates — scored in one pass over candidate pools fetched once
// per type for the whole date span, not row by row.
import { Prisma } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import { isKindAllowed } from "./kinds";
import { getLinkable } from "./linkable";
import { rank, scoreMatch } from "./scoring";
import {
  CANDIDATES_PER_TYPE,
  DATE_WINDOW_DAYS,
  DEFAULT_WINDOW_DAYS,
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

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The rows needing attention with their candidates, best first (HIGH > MEDIUM > LOW > none, then newest). */
export async function inboxRows(tx: TransactionClient, limit = INBOX_LIMIT): Promise<InboxRow[]> {
  const list = await banking.listTransactions(tx, {
    page: 1,
    pageSize: limit,
    sort: [{ col: "bookingDate", dir: "desc" }],
    filters: { state: { kind: "in", values: ["open", "partial"] } },
  });
  const accounts = (await banking.listMainAccountIds(tx)) ?? [];
  const main = new Set(accounts);
  const candidatesRows = list.rows.filter((r) => main.has(r.bankAccountId));
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

  // one candidate pool per direction × type over the whole span (each row then filters its own window)
  const pools = new Map<FlowDirection, EntityFacts[]>();
  for (const direction of ["incoming", "outgoing"] as const) {
    const dates = facts.filter((f) => f.direction === direction).map((f) => f.date);
    if (dates.length === 0) continue;
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const raw: Omit<EntityFacts, "remaining">[] = [];
    for (const type of JUSTIFIABLE[direction]) {
      const linkable = getLinkable(type);
      if (!linkable?.candidates || !isKindAllowed("justifies", "bank_transaction", type)) continue;
      const days = DATE_WINDOW_DAYS[type] ?? DEFAULT_WINDOW_DAYS;
      raw.push(
        ...(await linkable.candidates(tx, {
          direction,
          dateFrom: shiftDate(min, -days),
          dateTo: shiftDate(max, days),
          limit: CANDIDATES_PER_TYPE * 10,
        })),
      );
    }
    pools.set(direction, await withRemaining(tx, "to", raw));
  }

  const out: InboxRow[] = [];
  for (const r of candidatesRows) {
    const f = byId.get(r.id);
    if (!f) continue;
    const pool = pools.get(f.direction) ?? [];
    const scored: Suggestion[] = [];
    if (new D(f.remaining).gt(0)) {
      for (const c of pool) {
        const days = DATE_WINDOW_DAYS[c.type] ?? DEFAULT_WINDOW_DAYS;
        if (c.date < shiftDate(f.date, -days) || c.date > shiftDate(f.date, days)) continue;
        const m = scoreMatch(
          {
            amount: f.amount,
            currency: f.currency,
            amountBase: f.amountBase,
            date: f.date,
            texts: f.texts,
          },
          c,
        );
        if (!m) continue;
        scored.push({
          ...m,
          candidate: c,
          allocation: m.crossCurrency
            ? null
            : D.min(new D(f.remaining), new D(c.remaining)).toFixed(2),
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
