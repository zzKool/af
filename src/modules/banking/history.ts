// The side panel's History section (F71): what happened to one bank row, read from the audit trail — nothing stored.
// Three trails meet on a row: its own (`bank_transaction` create = the import), its journal entry's updates
// (category, partner, *no document needed*) and the links that touch it today. A removed link's trail is not found
// here: its row is gone and the kernel reads the trail by entity id only (lessons, F71 banking History).
import { getAuditLog } from "@/kernel/audit/audit";
import { mapInOrder, type TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import type { CategorisedBy } from "@/modules/journal";
import * as journal from "@/modules/journal";
import type { LinkableType, LinkKind } from "@/modules/linking";
import * as linking from "@/modules/linking";
import type { TransactionHistoryEvent } from "./types";

// MUST NOT import from next/* or src/components/*

/** One audit row as the kernel returns it (only what the mapping reads). */
export type AuditRow = {
  action: string;
  entityType: string;
  entityId: string;
  source: string;
  oldData: unknown;
  newData: unknown;
  createdAt: Date;
};

/** Per trail; a row's history is a handful of events, the cap only guards a runaway trail. */
const TRAIL_LIMIT = 100;

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const CATEGORISED_BY: readonly CategorisedBy[] = ["manual", "rule", "partner_default"];
const categorisedBy = (v: unknown): CategorisedBy | null =>
  CATEGORISED_BY.find((b) => b === v) ?? null;
const linkKind = (v: unknown): LinkKind | null => linking.LINK_KINDS.find((k) => k === v) ?? null;

/**
 * The audit rows of a bank row's trails → its history, newest first. Pure: `selfId` is the bank row, so a link's
 * other end is the endpoint that is not it. Rows that change nothing the owner sees (the entry's creation, the
 * implicit rate) are dropped; one journal update can give several events (category and partner in one save).
 */
export function toHistoryEvents(
  rows: readonly AuditRow[],
  selfId: string,
): TransactionHistoryEvent[] {
  const out: TransactionHistoryEvent[] = [];
  for (const r of rows) {
    const at = r.createdAt.toISOString();
    const base = { at, source: r.source };
    if (r.entityType === "bank_transaction" && r.action === "create") {
      out.push({ ...base, kind: "imported" });
    } else if (r.entityType === "journal_entry" && r.action === "update") {
      const before = record(r.oldData);
      const after = record(r.newData);
      const by = categorisedBy(after.categorisedBy);
      if (before.basCode !== after.basCode) {
        const code = text(after.basCode);
        out.push(
          code
            ? { ...base, kind: "categorised", basCode: code, by }
            : { ...base, kind: "uncategorised", by },
        );
      }
      if (before.partnerId !== after.partnerId) out.push({ ...base, kind: "partner", by });
      if (Boolean(before.noDocumentNeeded) !== Boolean(after.noDocumentNeeded)) {
        out.push({ ...base, kind: after.noDocumentNeeded ? "no_document" : "document_needed", by });
      }
    } else if (r.entityType === "link" && r.action === "create") {
      const link = record(r.newData);
      const fromSelf = link.fromId === selfId;
      const otherType = text(fromSelf ? link.toType : link.fromType) as LinkableType | null;
      const kind = linkKind(link.kind);
      if (otherType && kind) out.push({ ...base, kind: "linked", linkKind: kind, otherType });
    }
  }
  // newest first; same moment (one save) keeps the trail's order
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.at === b.e.at ? a.i - b.i : a.e.at < b.e.at ? 1 : -1))
    .map(({ e }) => e);
}

/** A bank row's history (the panel's *History* section): its trail, its journal entry's, its live links'. */
export async function transactionHistory(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<TransactionHistoryEvent[]>> {
  const exists = await tx.bankTransaction.findUnique({ where: { id }, select: { id: true } });
  if (!exists)
    return {
      error: { code: "NOT_FOUND", message: `Bank transaction not found: ${id}`, retryable: false },
    };
  const entries = await journal.entriesForSources(tx, "bank_transaction", [id]);
  const links = await linking.getLinksFor(tx, { type: "bank_transaction", id });
  const entry = entries.get(id);
  const trails: { entityType: string; entityId: string }[] = [
    { entityType: "bank_transaction", entityId: id },
    ...(entry ? [{ entityType: "journal_entry", entityId: entry.id }] : []),
    ...(links.data ?? []).map((l) => ({ entityType: "link", entityId: l.id })),
  ];
  const rows = (
    await mapInOrder(trails, (t) => getAuditLog(tx, { ...t, limit: TRAIL_LIMIT }))
  ).flat();
  return { data: toHistoryEvents(rows, id) };
}
