// F94 US6 (specs/subscriptions): the dashboard's subscriptions to-do — one item for the periods that need the
// owner, with the three counts; none when nothing needs him; not in the accountant's subset. Invented values.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { cleanupTestData, createTestPartner } from "@/kernel/db/test-fixtures";
import {
  importRows,
  type Owner,
  run,
  seedRates,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import * as subscriptions from "@/modules/subscriptions";
import { dashboardOverview } from "./overview";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const TODAY = "2026-03-26";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;

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
});
afterAll(async () => {
  await adminPool.end();
});

async function sub(name: string, startDate: string) {
  const p = await createTestPartner(adminPool, owner.caller.tenantId, owner.caller.userId, {
    name,
    types: ["vendor"],
  });
  const r = await run(owner.caller, (tx) =>
    subscriptions.createSubscription(
      tx,
      owner.caller,
      { log: async () => {} },
      {
        name,
        partnerId: p.id,
        becomes: "expense",
        basCode: "580",
        newGroup: { description: name },
        paymentSourceId: owner.sources.afSek.id,
        cadence: "monthly",
        startDate,
        matchText: name.toUpperCase(),
        price: { amount: "199.00", currency: "SEK" },
      },
    ),
  );
  if (r.error) throw new Error(r.error.message);
}

const item = async (caller: CallerIdentity = owner.caller) =>
  (await run(owner.caller, (tx) => dashboardOverview(tx, caller, TODAY, null))).items.find(
    (i) => i.kind === "subscriptions_attention",
  );

describe("dashboard — the subscriptions item (US6)", () => {
  it("no subscription → no item", async () => {
    expect(await item()).toBeUndefined();
  });

  it("a row to confirm and a charge missing → one item, the counts in its params, medium priority", async () => {
    await sub("Byteform", "2026-03-15"); // its row is imported below → to confirm
    await sub("Kodkassen", "2026-03-10"); // no row by the 17th → charge missing
    await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-16", amount: "-199.00", name: "BYTEFORM AB" },
      ]),
    );
    expect(await item()).toMatchObject({
      count: 2,
      params: { toConfirm: 1, chargeMissing: 1, documentMissing: 0 },
      priority: "medium",
      href: "/subscriptions?f.attention=range:1:",
    });
  });

  it("the accountant's subset has no subscriptions item", async () => {
    await sub("Kodkassen", "2026-03-10");
    expect(await item({ ...owner.caller, role: "accountant" })).toBeUndefined();
  });
});
