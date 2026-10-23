// The sync job on the real table (T001): one run refills the pair furthest behind, not only the newest one.
// The ECB is simulated: it answers `lastNObservations` per series, as the real one does.
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATION_URL } from "@/kernel/db/test-setup";
import { ecbSyncJob } from "./ecb-sync";

vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let adminPool: Pool;
const TODAY = "2026-10-21"; // Wed; the ECB has published up to Tue 10-20

/** ECB weekdays from `from` to `to`, both inclusive. */
function weekdays(from: string, to: string): string[] {
  const days: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
const PUBLISHED = weekdays("2026-09-01", "2026-10-20");

function ecbAnswer(url: string): Response {
  const lastN = Number(new URL(url).searchParams.get("lastNObservations"));
  const series = ["SEK", "CHF", "USD"].map(
    (ccy) =>
      `<generic:Series><generic:SeriesKey><generic:Value id="CURRENCY" value="${ccy}"/></generic:SeriesKey>${PUBLISHED.slice(
        -lastN,
      )
        .map(
          (day) =>
            `<generic:Obs><generic:ObsDimension value="${day}"/><generic:ObsValue value="1.5"/></generic:Obs>`,
        )
        .join("")}</generic:Series>`,
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><message:GenericData xmlns:message="m" xmlns:generic="g"><message:DataSet>${series.join("")}</message:DataSet></message:GenericData>`,
    { status: 200 },
  );
}

async function store(pair: string, through: string): Promise<void> {
  for (const day of weekdays("2026-09-01", through))
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, $2, 1.5)`,
      [day, pair],
    );
}

async function storedDays(pair: string): Promise<string[]> {
  const { rows } = await adminPool.query(
    `SELECT date::text FROM ecb_rates WHERE currency_pair = $1 AND date >= '2026-10-01' ORDER BY date`,
    [pair],
  );
  return rows.map((r) => r.date);
}

beforeAll(() => {
  adminPool = new Pool({ connectionString: MIGRATION_URL });
});
beforeEach(async () => {
  await adminPool.query("TRUNCATE ecb_rates");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`)); // noon in Stockholm
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await adminPool.end();
});

describe("rates.ecb-sync — the catch-up covers every pair (T001)", () => {
  it("a pair two weeks behind while the others are current is refilled in one run", async () => {
    await store("EUR/SEK", "2026-10-20");
    await store("EUR/USD", "2026-10-20");
    await store("EUR/CHF", "2026-10-06"); // a partial ECB answer two weeks ago
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (u) => ecbAnswer(String(u)));

    await ecbSyncJob.handler({}, { id: "job-1", attempt: 0 });

    // sized from CHF: 10 weekdays missing (10-07 … 10-20) + 2 — the newest pair alone would have asked for 5
    expect(String(fetchSpy.mock.calls[0][0])).toContain("lastNObservations=12");
    expect(await storedDays("EUR/CHF")).toEqual(weekdays("2026-10-01", "2026-10-20"));
  });

  it("a pair one day behind is refilled", async () => {
    await store("EUR/SEK", "2026-10-20");
    await store("EUR/USD", "2026-10-20");
    await store("EUR/CHF", "2026-10-19");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => ecbAnswer(String(u)));

    await ecbSyncJob.handler({}, { id: "job-1", attempt: 0 });

    expect((await storedDays("EUR/CHF")).at(-1)).toBe("2026-10-20");
  });
});
