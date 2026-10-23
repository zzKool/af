// An entry's History (F71, the panel's last section): the audit trail of `journal_entry` rows, read back.
// Every write is audited (create by the import or *New entry*, update by categorise, delete), so the trail is the
// history — nothing new is stored. An update names the owner's facts it changed; the money facts never change.
import { getAuditLog } from "@/kernel/audit/audit";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import {
  type CategorisedBy,
  JOURNAL_FACTS,
  type JournalFact,
  type JournalHistoryItem,
} from "./types";

const ACTIONS = new Set(["create", "update", "delete"]);
const BY = new Set<string>(["manual", "rule"]); // partner_default is never written (audit 32)
/** an entry's trail is short (create + a few categorisations); the panel shows at most this many lines */
const LIMIT = 50;

type Data = Record<string, unknown> | null;

function asData(value: unknown): Data {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The facts that differ between two audit snapshots; `""` and null are the same blank. */
export function changedFacts(oldData: Data, newData: Data): JournalFact[] {
  if (!oldData || !newData) return [];
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
  return JOURNAL_FACTS.filter((f) => norm(oldData[f]) !== norm(newData[f]));
}

export async function entryHistory(
  tx: TransactionClient,
  id: string,
): Promise<JournalHistoryItem[]> {
  const rows = await getAuditLog(tx, { entityType: "journal_entry", entityId: id, limit: LIMIT });
  return rows.flatMap((r) => {
    if (!ACTIONS.has(r.action)) return [];
    const oldData = asData(r.oldData);
    const newData = asData(r.newData);
    const action = r.action as JournalHistoryItem["action"];
    const changed = action === "update" ? changedFacts(oldData, newData) : [];
    // an update that changed none of the owner's facts (the retired implicit-rate write) is not history
    if (action === "update" && changed.length === 0) return [];
    const by = action === "update" ? newData?.categorisedBy : null;
    return [
      {
        at: r.createdAt.toISOString(),
        action,
        by: typeof by === "string" && BY.has(by) ? (by as CategorisedBy) : null,
        changed,
      },
    ];
  });
}
