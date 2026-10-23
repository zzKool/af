// A build's counts (`package_builds.counts`, JSONB): written by `markBuilt` from `countsOf`, read back here — one
// read mapper instead of a cast (lessons audit 29, the F50-b pattern). Pure: no db.
import type { Prisma } from "@/generated/prisma/client";
import type { PackageCounts } from "./types";

export const EMPTY_COUNTS: PackageCounts = {
  bankRows: 0,
  invoices: 0,
  supplierInvoices: 0,
  expenses: 0,
  settlements: 0,
  documents: 0,
};

const KEYS = Object.keys(EMPTY_COUNTS) as (keyof PackageCounts)[];

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * `counts` → the six counts: each known key that holds a whole non-negative number, 0 otherwise; other keys are
 * dropped. A column that is not an object (null, an array, a scalar) reads as no counts.
 */
export function parsePackageCounts(json: Prisma.JsonValue | null): PackageCounts {
  const out: PackageCounts = { ...EMPTY_COUNTS };
  if (typeof json !== "object" || json === null || Array.isArray(json)) return out;
  for (const key of KEYS) {
    const value = json[key];
    if (isCount(value)) out[key] = value;
  }
  return out;
}
