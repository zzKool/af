// The one place the package module maps its derived states → the D40 families (ui-conventions *States and
// tags*). Client-safe (no Prisma). Nothing here is stored: a period's state is read from its live counts, its
// flags and its builds — the month-end checklist; a build's from its row's status (the job writes it).
//
//   period    family     when
//   building  progress   the latest build is queued or building
//   failed    attention  the latest build failed (nothing stored — build again)
//   flagged   attention  flags the accountant would ask about (notes.md's list)
//   built     done       a package is built and nothing is flagged
//   ready     progress   something to send, nothing flagged, not built yet
//   empty     neutral    no bank line, invoice, supplier invoice, expense or document in the period
import type { StateFamily } from "@/kernel/ui/state-label";
import type { PackageBuildStatus, PackageCounts } from "./types";

export const PERIOD_STATES = ["building", "failed", "flagged", "built", "ready", "empty"] as const;
export type PeriodState = (typeof PERIOD_STATES)[number];

export const PERIOD_STATE_FAMILY: Readonly<Record<PeriodState, StateFamily>> = {
  building: "progress",
  failed: "attention",
  flagged: "attention",
  built: "done",
  ready: "progress",
  empty: "neutral",
};

export const BUILD_STATUS_FAMILY: Readonly<Record<PackageBuildStatus, StateFamily>> = {
  queued: "progress",
  building: "progress",
  built: "done",
  failed: "attention",
};

export const isRunning = (b: { status: PackageBuildStatus }): boolean =>
  b.status === "queued" || b.status === "building";

/** A period's checklist state. `builds` newest first (the overview's order). */
export function periodState(row: {
  counts: PackageCounts;
  flags: number;
  builds: readonly { status: PackageBuildStatus }[];
}): PeriodState {
  const latest = row.builds[0];
  if (latest && isRunning(latest)) return "building";
  if (latest?.status === "failed") return "failed";
  if (row.flags > 0) return "flagged";
  if (row.builds.some((b) => b.status === "built")) return "built";
  const { bankRows, invoices, supplierInvoices, expenses, settlements, documents } = row.counts;
  return bankRows + invoices + supplierInvoices + expenses + settlements + documents === 0
    ? "empty"
    : "ready";
}
