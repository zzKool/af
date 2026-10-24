import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "@/kernel/clock/calendar";
import cases from "../../../specs/contracts/fixtures/rate-history-cases.json";
import { covers, lockedFieldsChanged, overlaps, pickRate, rateState } from "./contract-rates";

type Rate = { id: string; validFrom: string; validTo: string | null; rate: string };

describe("rate lookup — the owner's history (specs/contracts/fixtures/rate-history-cases.json)", () => {
  const rates = cases.rates as Rate[];

  it.each(cases.lookupCases)(
    "$case: $date → $expectRateId",
    ({ date, expectRateId, expectRate }) => {
      const hit = pickRate(rates, date);
      expect(hit?.id ?? null).toBe(expectRateId);
      expect(hit?.rate ?? null).toBe(expectRate);
    },
  );

  it.each(cases.gapScenario.cases)(
    "gap scenario $case: $date → $expectRateId",
    ({ date, expectRateId }) => {
      expect(pickRate(cases.gapScenario.rates as Rate[], date)?.id ?? null).toBe(expectRateId);
    },
  );

  it("states are relative to a given today, never stored", () => {
    const r2025 = rates[0];
    const r2026 = rates[1];
    expect(rateState(r2025, "2025-06-01")).toBe("current");
    expect(rateState(r2025, "2026-01-01")).toBe("expired");
    expect(rateState(r2026, "2025-12-31")).toBe("future");
    expect(rateState(r2026, "2030-01-01")).toBe("current"); // open end
  });

  it("intervals are inclusive on both ends and touching intervals overlap", () => {
    expect(covers({ validFrom: "2025-01-01", validTo: "2025-12-31" }, "2025-12-31")).toBe(true);
    expect(covers({ validFrom: "2025-01-01", validTo: "2025-12-31" }, "2026-01-01")).toBe(false);
    expect(
      overlaps(
        { validFrom: "2025-01-01", validTo: "2025-12-31" },
        { validFrom: "2025-12-31", validTo: null },
      ),
    ).toBe(true);
    expect(
      overlaps(
        { validFrom: "2025-01-01", validTo: "2025-12-31" },
        { validFrom: "2026-01-01", validTo: null },
      ),
    ).toBe(false);
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});

// --- property: for any non-overlapping history and any day, the pick is the unique containing interval ---

const isoDay = fc.integer({ min: 0, max: 365 * 12 }).map((n) => addDays("2020-01-01", n));

/** A random non-overlapping history: sorted starts, each closed before the next starts; the last may be open. */
const history = fc
  .uniqueArray(isoDay, { minLength: 1, maxLength: 8 })
  .map((days) => [...days].sort())
  .chain((starts) =>
    fc
      .tuple(
        ...starts.map((_, i) =>
          i === starts.length - 1
            ? fc.option(fc.integer({ min: 0, max: 400 }))
            : fc.integer({ min: 0, max: 400 }),
        ),
      )
      .map((lengths) =>
        starts.map((validFrom, i) => {
          const maxEnd = i + 1 < starts.length ? addDays(starts[i + 1], -1) : null;
          const len = lengths[i];
          let validTo: string | null = len === null ? null : addDays(validFrom, len);
          if (maxEnd !== null && (validTo === null || validTo > maxEnd)) validTo = maxEnd;
          return { id: `r${i}`, validFrom, validTo, rate: `${1000 + i}.00` };
        }),
      ),
  );

describe("rate lookup — property", () => {
  it("returns the unique interval containing the day, or null (200 runs)", () => {
    fc.assert(
      fc.property(history, isoDay, (rates, day) => {
        for (let i = 0; i < rates.length; i++)
          for (let j = i + 1; j < rates.length; j++)
            expect(overlaps(rates[i], rates[j])).toBe(false);
        const containing = rates.filter((r) => covers(r, day));
        expect(containing.length).toBeLessThanOrEqual(1);
        expect(pickRate(rates, day)?.id ?? null).toBe(containing[0]?.id ?? null);
      }),
      { numRuns: 200 },
    );
  });
});

describe("a used rate only closes — the fields it refuses (F63)", () => {
  const before = { validFrom: "2025-01-01", rate: "1000.00" };

  it("start and amount are locked; end and note are not", () => {
    expect(lockedFieldsChanged(before, { rate: "1100.00" })).toEqual(["rate"]);
    expect(lockedFieldsChanged(before, { validFrom: "2025-02-01" })).toEqual(["validFrom"]);
    expect(lockedFieldsChanged(before, { validFrom: "2024-12-01", rate: "1" })).toEqual([
      "validFrom",
      "rate",
    ]);
    expect(lockedFieldsChanged(before, {})).toEqual([]);
  });

  it("the same value sent again is not a change (decimal equality, not string)", () => {
    expect(lockedFieldsChanged(before, { validFrom: "2025-01-01", rate: "1000" })).toEqual([]);
    expect(lockedFieldsChanged(before, { rate: "1000.0" })).toEqual([]);
    expect(lockedFieldsChanged(before, { rate: "1000.01" })).toEqual(["rate"]);
  });
});
