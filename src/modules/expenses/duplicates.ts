// The entity duplicate check for expenses (specs/documents US3, D32): the same bytes already became an expense
// (high), or a similar expense exists — same currency, amount within 1 %, date within 7 days, same merchant name
// (medium). Pure helpers shared with supplier invoices; the queries read this module's table and, through the
// documents and linking surfaces, the twins of the source document.
import { addDays, daysBetween } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as documents from "@/modules/documents";
import * as linking from "@/modules/linking";
import type { DuplicateMatch } from "./types";

export const DUPLICATE_AMOUNT_TOLERANCE = 0.01;
export const DUPLICATE_DATE_TOLERANCE_DAYS = 7;
export const DUPLICATE_MAX = 5;

export type ExpenseDuplicateQuery = {
  documentId?: string;
  merchant?: string | null;
  amount?: string | null;
  currency?: string | null;
  date?: string | null;
};

export const foldName = (s: string | null | undefined) =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** amount within ±1 % and date within ±7 days — the harvest's fuzzy rule, same currency required by the caller. */
export function isNear(
  query: { amount: number; date: string },
  candidate: { amount: number; date: string },
): boolean {
  if (!Number.isFinite(query.amount) || query.amount <= 0) return false;
  const tolerance = query.amount * DUPLICATE_AMOUNT_TOLERANCE;
  return (
    Math.abs(candidate.amount - query.amount) <= tolerance + 1e-9 &&
    daysBetween(query.date, candidate.date) <= DUPLICATE_DATE_TOLERANCE_DAYS
  );
}

const RANK = { high: 0, medium: 1 } as const;

/** One entry per entity (the first strategy that found it wins), high before medium, at most five. */
export function dedupeMatches(matches: DuplicateMatch[]): DuplicateMatch[] {
  const seen = new Set<string>();
  const out: DuplicateMatch[] = [];
  for (const m of matches) {
    const id = `${m.entityType}:${m.entityId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(m);
  }
  return out.sort((a, b) => RANK[a.confidence] - RANK[b.confidence]).slice(0, DUPLICATE_MAX);
}

/** The entities of `entityType` created from the documents holding the same bytes as `documentId`. */
export async function createdFromTwins(
  tx: TransactionClient,
  documentId: string,
  entityType: "expense" | "supplier_invoice",
): Promise<string[]> {
  const twins = await documents.sameContentDocumentIds(tx, documentId);
  if (twins.length === 0) return [];
  const links = await linking.linksTouching(tx, "document", twins);
  return links
    .filter((l) => l.kind === "created_from" && l.from.type === entityType)
    .map((l) => l.from.id);
}

export async function findExpenseDuplicates(
  tx: TransactionClient,
  query: ExpenseDuplicateQuery,
): Promise<DuplicateMatch[]> {
  const found: DuplicateMatch[] = [];

  // B — the same file already made an expense
  if (query.documentId) {
    const ids = await createdFromTwins(tx, query.documentId, "expense");
    if (ids.length > 0) {
      const rows = await tx.expense.findMany({
        where: { id: { in: ids } },
        select: { id: true, key: true },
      });
      for (const r of rows) {
        found.push({
          kind: "hash",
          confidence: "high",
          entityType: "expense",
          entityId: r.id,
          entityKey: r.key,
          partnerName: null,
          reason: {
            key: "documents.duplicate.reason.hash",
            params: { kind: "expense", key: r.key },
          },
        });
      }
    }
  }

  // C′ — a similar expense with the same merchant name
  const merchant = foldName(query.merchant);
  const amount = Number(query.amount);
  if (merchant && query.currency && query.date && Number.isFinite(amount) && amount > 0) {
    const from = new Date(`${addDays(query.date, -DUPLICATE_DATE_TOLERANCE_DAYS)}T00:00:00Z`);
    const to = new Date(`${addDays(query.date, DUPLICATE_DATE_TOLERANCE_DAYS)}T00:00:00Z`);
    const rows = await tx.expense.findMany({
      where: { currency: query.currency, date: { gte: from, lte: to } },
      select: { id: true, key: true, description: true, amount: true, date: true, currency: true },
    });
    for (const r of rows) {
      const date = r.date.toISOString().slice(0, 10);
      if (foldName(r.description) !== merchant) continue;
      if (!isNear({ amount, date: query.date }, { amount: Number(r.amount), date })) continue;
      found.push({
        kind: "fuzzy",
        confidence: "medium",
        entityType: "expense",
        entityId: r.id,
        entityKey: r.key,
        partnerName: null,
        reason: {
          key: "documents.duplicate.reason.fuzzyExpense",
          params: { key: r.key, amount: r.amount.toFixed(2), currency: r.currency, date },
        },
      });
    }
  }

  return dedupeMatches(found);
}
