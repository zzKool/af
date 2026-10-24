import { describe, expect, it } from "vitest";
import { JournalCategorisedBy, RateSource as RateSourceEnum } from "@/generated/prisma/enums";
import { journalRateSource } from "./rate-source";
import { RATE_SOURCES } from "./types";

// F67 / lessons audit 30: one Postgres `rate_source` enum for journal, expenses and supplier invoices.
describe("journal rate source", () => {
  it("the journal's rate sources are the enum's, less the bank's own base", () => {
    expect([...RATE_SOURCES].sort()).toEqual(
      Object.values(RateSourceEnum)
        .filter((s) => s !== "bank")
        .sort(),
    );
  });

  it("maps every journal source as itself and refuses `bank` (journal_entries' CHECK)", () => {
    for (const s of RATE_SOURCES) expect(journalRateSource(s)).toBe(s);
    expect(() => journalRateSource("bank")).toThrow(/rate_source = bank/);
  });

  it("partner_default is gone from the categorised-by enum (audit 32)", () => {
    expect(Object.values(JournalCategorisedBy).sort()).toEqual(["manual", "rule"]);
  });
});
