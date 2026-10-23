import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { countWeekdaysBetween, rateStatus } from "./ecb-rates";

// Audit 28: the weekday counts and the status window ran on Date instants with getDay / setDate, so the
// server's time zone moved them a day (west of UTC every ISO day starts the evening before). Each test runs
// once in UTC and once in a zone where the old code was wrong.
const ZONES = ["UTC", "America/New_York"] as const;

describe.each(ZONES)("rates calendar days in %s", (zone) => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  test("Friday → Sunday has no weekday between (New York counted the Friday)", () => {
    expect(countWeekdaysBetween("2026-10-16", "2026-10-18")).toBe(0);
    expect(countWeekdaysBetween("2026-10-16", "2026-10-19")).toBe(0);
    expect(countWeekdaysBetween("2026-10-16", "2026-10-21")).toBe(2);
  });

  test("rateStatus' window is today − 30 and today − 2 as days, across a DST change", async () => {
    const args: unknown[][] = [];
    const db = {
      $queryRawUnsafe: async (_q: string, ...a: unknown[]) => {
        args.push(a);
        return [
          {
            currency_pair: "EUR/SEK",
            latest_date: "2026-11-06",
            latest_rate: "11.1",
            stored_days: 20,
          },
        ];
      },
    };
    // 2026-11-01 is the US switch to winter time: setDate on a local instant landed on 2026-10-10
    const [status] = await rateStatus(db, "2026-11-10", { currencyPairs: ["EUR/SEK"] });
    expect(args[0].slice(1)).toEqual(["2026-10-11", "2026-11-08"]);
    // weekdays 2026-10-11 … 2026-11-08, both inclusive: 20, all stored
    expect(status).toMatchObject({ pair: "EUR/SEK", storedDays: 20, missingWeekdays: 0 });
  });
});
