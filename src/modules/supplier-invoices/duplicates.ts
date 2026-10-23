// The entity duplicate check for supplier invoices (specs/documents US3, D32): the same partner and number
// (high, normalised — a refusal, D35: the number is unique per supplier, a cancelled invoice keeps it too), the
// same bytes already made a supplier invoice (high), a similar invoice of the same partner — same currency, amount
// within 1 %, date within 7 days (medium). The pure rules are expenses'.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import {
  createdFromTwins,
  DUPLICATE_DATE_TOLERANCE_DAYS,
  type DuplicateMatch,
  dedupeMatches,
  isNear,
} from "@/modules/expenses";
import * as partners from "@/modules/partners";
import { normaliseInvoiceNumber } from "./invoice-number";

export { normaliseInvoiceNumber };

export type SupplierInvoiceDuplicateQuery = {
  documentId?: string;
  partnerId?: string | null;
  invoiceNumber?: string | null;
  amount?: string | null;
  currency?: string | null;
  date?: string | null;
};

export type SupplierInvoiceCandidate = {
  id: string;
  key: string;
  partnerId: string;
  invoiceNumber: string;
  /** yyyy-mm-dd */
  invoiceDate: string;
  amountTotal: string;
  currency: string;
  /** a cancelled invoice still holds its number (the unique index, D35) — only the exact rule sees it */
  cancelled?: boolean;
};

/**
 * The pure rules over the candidates (the partner's invoices — cancelled ones only for A — for A and C, the
 * entities the same bytes already became for B): A before B before C, one entry per entity, high first, at most five.
 */
export function evaluateSupplierInvoiceDuplicates(
  query: SupplierInvoiceDuplicateQuery,
  candidates: readonly SupplierInvoiceCandidate[],
  twinEntityIds: readonly string[],
  partnerNames: ReadonlyMap<string, string>,
): DuplicateMatch[] {
  const found: DuplicateMatch[] = [];
  const nameOf = (id: string) => partnerNames.get(id) ?? "";

  if (query.partnerId) {
    const rows = candidates.filter((c) => c.partnerId === query.partnerId);
    const number = normaliseInvoiceNumber(query.invoiceNumber);
    if (number) {
      for (const r of rows) {
        if (normaliseInvoiceNumber(r.invoiceNumber) !== number) continue;
        found.push({
          kind: "exact",
          confidence: "high",
          entityType: "supplier_invoice",
          entityId: r.id,
          entityKey: r.key,
          partnerName: nameOf(r.partnerId),
          reason: {
            key: "documents.duplicate.reason.exact",
            params: { n: r.invoiceNumber, partner: nameOf(r.partnerId) },
          },
        });
      }
    }
  }

  for (const id of twinEntityIds) {
    const r = candidates.find((c) => c.id === id);
    if (!r || r.cancelled) continue;
    found.push({
      kind: "hash",
      confidence: "high",
      entityType: "supplier_invoice",
      entityId: r.id,
      entityKey: r.key,
      partnerName: nameOf(r.partnerId),
      reason: {
        key: "documents.duplicate.reason.hash",
        params: { kind: "supplier_invoice", key: r.key },
      },
    });
  }

  const amount = Number(query.amount);
  if (query.partnerId && query.currency && query.date && Number.isFinite(amount) && amount > 0) {
    for (const r of candidates) {
      if (r.cancelled || r.partnerId !== query.partnerId || r.currency !== query.currency) continue;
      if (
        !isNear(
          { amount, date: query.date },
          { amount: Number(r.amountTotal), date: r.invoiceDate },
        )
      )
        continue;
      found.push({
        kind: "fuzzy",
        confidence: "medium",
        entityType: "supplier_invoice",
        entityId: r.id,
        entityKey: r.key,
        partnerName: nameOf(r.partnerId),
        reason: {
          key: "documents.duplicate.reason.fuzzy",
          params: {
            n: r.invoiceNumber,
            amount: Number(r.amountTotal).toFixed(2),
            currency: r.currency,
            date: r.invoiceDate,
          },
        },
      });
    }
  }
  return dedupeMatches(found);
}

export async function findSupplierInvoiceDuplicates(
  tx: TransactionClient,
  query: SupplierInvoiceDuplicateQuery,
): Promise<DuplicateMatch[]> {
  const twinIds = query.documentId
    ? await createdFromTwins(tx, query.documentId, "supplier_invoice")
    : [];
  if (!query.partnerId && twinIds.length === 0) return [];
  const rows = await tx.supplierInvoice.findMany({
    where: {
      OR: [
        ...(query.partnerId ? [{ partnerId: query.partnerId }] : []),
        ...(twinIds.length ? [{ id: { in: twinIds } }] : []),
      ],
    },
    select: {
      id: true,
      key: true,
      partnerId: true,
      invoiceNumber: true,
      invoiceDate: true,
      amountTotal: true,
      currency: true,
      cancelled: true,
    },
  });
  const names = await partners.partnerNames(tx, [...new Set(rows.map((r) => r.partnerId))]);
  return evaluateSupplierInvoiceDuplicates(
    query,
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      partnerId: r.partnerId,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate.toISOString().slice(0, 10),
      amountTotal: r.amountTotal.toFixed(2),
      currency: r.currency,
      cancelled: r.cancelled,
    })),
    twinIds,
    names,
  );
}

export { DUPLICATE_DATE_TOLERANCE_DAYS };
