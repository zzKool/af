// Global search (F93, D56) for subscriptions (F94): by name, vendor, match text, an expected amount in any format;
// the accountant reads; another tenant sees nothing. Real database, RLS on; invented values.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import type { SearchGroup } from "@/kernel/search/types";
import { type Owner, run, seedRates, setupOwner } from "@/modules/expenses/__fixtures__/harness";
import { subscription, vendor } from "./__fixtures__/harness";
import { searchSubscriptionHits } from "./search";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
let id: string;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  await seedRates(adminPool);
  owner = await setupOwner(adminPool, nordeaFormatId);
  const partnerId = await vendor(adminPool, owner.caller, "Tabula GmbH");
  id = await subscription(owner.caller, {
    name: "Tabula Pro",
    partnerId,
    becomes: "expense",
    basCode: "580",
    newGroup: { description: "Tabula Pro" },
    paidFromAccountId: owner.sources.afSek.id,
    cadence: "monthly",
    startDate: "2026-01-14",
    matchText: "TABULA*PRO",
    price: { amount: "1250.00", currency: "SEK" },
  });
});
afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

const search = async (q: string, caller = owner.caller): Promise<SearchGroup> => {
  const r = await run(caller, (tx) => searchSubscriptionHits(tx, caller, q));
  if (!r.data) throw new Error(r.error.message);
  return r.data;
};

describe("searchSubscriptionHits", () => {
  it("finds it by name, vendor, match text and the expected amount in any format", async () => {
    for (const q of ["tabula pro", "GmbH", "*pro", "1250", "1 250,00", "1'250.00"]) {
      const g = await search(q);
      expect(
        g.hits.map((h) => h.id),
        q,
      ).toEqual([id]);
    }
    const [hit] = (await search("Tabula")).hits;
    expect(hit).toMatchObject({
      kind: "subscription",
      label: "Tabula Pro · Tabula GmbH",
      amount: "1250.00",
      currency: "SEK",
      href: `/subscriptions?open=${id}`,
    });
    expect((await search("Byteform")).hits).toEqual([]);
  });

  it("another tenant sees nothing; the accountant reads", async () => {
    const other = await setupOwner(adminPool, nordeaFormatId);
    expect((await search("Tabula", other.caller)).hits).toEqual([]);
    const accountant = { ...owner.caller, role: "accountant" as const };
    expect((await search("Tabula", accountant)).hits.map((h) => h.id)).toEqual([id]);
  });
});
