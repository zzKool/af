// The stored `rate_source` (one Postgres enum shared with expenses and supplier invoices, F67) → the journal's.
// MUST NOT import from next/* or src/components/*
import type { RateSource as StoredRateSource } from "@/generated/prisma/client";
import type { RateSource } from "./types";

/** The shared `rate_source` enum less `bank`: `journal_entries_rate_source_check` keeps the bank's own base out of
 * the journal (the bank row *is* the entry), so a `bank` here is a broken invariant, not a value to show. */
export function journalRateSource(stored: StoredRateSource): RateSource {
  if (stored === "bank")
    throw new Error("journal_entries.rate_source = bank — the CHECK should refuse it");
  return stored;
}
