// The details panel's History (D40) for one expense, read from the audit trail every write leaves — pure, so the
// rule (which fields changed, newest first) is tested without a database. Client-safe: no Prisma import.
//
//   create  → the moment it was written, no field list
//   update  → the fields whose stored value changed; `updatedAt` and the bookkeeping columns are not news
//
// Money fields are in the trail as decimal strings since F84, so an amount edit names *Amount* like any other.

export type AuditRow = {
  id: string;
  action: string;
  oldData: unknown;
  newData: unknown;
  createdAt: Date | string;
};

/** The fields the panel can name — each maps to a label key the module already has. */
export const HISTORY_FIELDS = [
  "date",
  "description",
  "basCode",
  "amount",
  "currency",
  "vatAmount",
  "paidFromAccountId",
  "paidAmount",
  "documentMissing",
  "partnerId",
  "note",
] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];

export type HistoryEntry = {
  id: string;
  action: "create" | "update" | "delete";
  /** ISO timestamp */
  at: string;
  fields: HistoryField[];
};

const ACTIONS = new Set(["create", "update", "delete"]);

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Fields whose value differs between two audit snapshots, in HISTORY_FIELDS order. */
export function changedFields(oldData: unknown, newData: unknown): HistoryField[] {
  const before = asRecord(oldData);
  const after = asRecord(newData);
  return HISTORY_FIELDS.filter(
    (f) => (f in before || f in after) && JSON.stringify(before[f]) !== JSON.stringify(after[f]),
  );
}

export function expenseHistory(rows: readonly AuditRow[]): HistoryEntry[] {
  return rows
    .filter((r) => ACTIONS.has(r.action))
    .map((r) => ({
      id: r.id,
      action: r.action as HistoryEntry["action"],
      at: new Date(r.createdAt).toISOString(),
      fields: r.action === "update" ? changedFields(r.oldData, r.newData) : [],
    }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
