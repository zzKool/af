// F94 (specs/subscriptions, D57) — the database's own guarantees, independent of the service (T003): the CHECKs,
// the price exclusion (the contract-rate invariant), one `occurrence_of` per entity, RLS.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestData, createTestTenant } from "@/kernel/db/test-fixtures";

const ADMIN_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const APP_URL = process.env.DATABASE_TEST_URL || "postgresql://af_app:app@localhost:5433/af_test";

let admin: Pool;
let app: Pool;
let tenantId: string;
let groupId: string;
let payerId: string;
const user = randomUUID();

async function insertSubscription(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    id: randomUUID(),
    tenant_id: tenantId,
    name: `Tabula Pro ${randomUUID().slice(0, 6)}`,
    partner_id: randomUUID(),
    becomes: "expense",
    bas_code: "6540",
    group_id: groupId,
    paid_from_account_id: payerId,
    cadence: "monthly",
    start_date: "2026-01-14",
    created_by: user,
    ...overrides,
  };
  const cols = Object.keys(row);
  await admin.query(
    `INSERT INTO subscriptions (${cols.join(", ")}, updated_at) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, NOW())`,
    Object.values(row),
  );
  return row.id;
}

async function insertPrice(
  subscriptionId: string,
  from: string,
  to: string | null,
  amount = "20.00",
) {
  await admin.query(
    `INSERT INTO subscription_prices (tenant_id, subscription_id, valid_from, valid_to, amount, currency, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'EUR', $6, NOW())`,
    [tenantId, subscriptionId, from, to, amount, user],
  );
}

beforeAll(() => {
  admin = new Pool({ connectionString: ADMIN_URL });
  app = new Pool({ connectionString: APP_URL });
});
afterAll(async () => {
  await cleanupTestData(admin);
  await admin.end();
  await app.end();
});
beforeEach(async () => {
  await cleanupTestData(admin);
  tenantId = (await createTestTenant(admin)).id;
  // the payer: a private instrument of the owner (F114: a bank account with role owner_private, no format)
  payerId = randomUUID();
  await admin.query(
    `INSERT INTO bank_accounts (id, tenant_id, account_alias, account_number, currency, bank_format_id, role, created_by)
     VALUES ($1, $2, 'Private SE', 'Private SE', 'SEK', NULL, 'owner_private', $3)`,
    [payerId, tenantId, user],
  );
  groupId = randomUUID();
  await admin.query(
    `INSERT INTO expense_groups (id, tenant_id, number, description, kind, created_by, updated_at)
     VALUES ($1, $2, 220, 'Tabula Pro', 'batch', $3, NOW())`,
    [groupId, tenantId, user],
  );
});

describe("subscriptions — CHECKs", () => {
  it("accepts a valid subscription with the default tolerance of 5", async () => {
    const id = await insertSubscription();
    const r = await admin.query("SELECT tolerance_pct FROM subscriptions WHERE id = $1", [id]);
    expect(r.rows[0].tolerance_pct).toBe("5.00");
  });
  it("refuses a tolerance outside 0–50", async () => {
    await expect(insertSubscription({ tolerance_pct: "50.01" })).rejects.toThrow(
      /subscriptions_tolerance_check/,
    );
    await expect(insertSubscription({ tolerance_pct: "-1" })).rejects.toThrow(
      /subscriptions_tolerance_check/,
    );
  });
  it("refuses an end date before the start date", async () => {
    await expect(insertSubscription({ end_date: "2026-01-13" })).rejects.toThrow(
      /subscriptions_dates_check/,
    );
  });
  it("refuses a blank name and a second subscription with the same name", async () => {
    await expect(insertSubscription({ name: "  " })).rejects.toThrow(/subscriptions_name_check/);
    await insertSubscription({ name: "Byteform" });
    await expect(insertSubscription({ name: "Byteform" })).rejects.toThrow(
      /subscriptions_tenant_name_key/,
    );
  });
  it("keeps the group: a group with a subscription cannot be deleted", async () => {
    await insertSubscription();
    await expect(
      admin.query("DELETE FROM expense_groups WHERE id = $1", [groupId]),
    ).rejects.toThrow(/subscriptions_group_id_fkey/);
  });
});

describe("subscription_prices — the contract-rate invariant", () => {
  it("accepts consecutive prices and refuses an overlap, both bounds inclusive", async () => {
    const id = await insertSubscription();
    await insertPrice(id, "2026-01-14", "2026-09-13");
    await insertPrice(id, "2026-09-14", null, "22.00");
    await expect(insertPrice(id, "2026-09-13", "2026-09-13")).rejects.toThrow(
      /subscription_prices_no_overlap/,
    );
    await expect(insertPrice(id, "2027-01-01", null)).rejects.toThrow(
      /subscription_prices_no_overlap/,
    );
  });
  it("lets two subscriptions have prices on the same days", async () => {
    const a = await insertSubscription();
    const b = await insertSubscription();
    await insertPrice(a, "2026-01-14", null);
    await insertPrice(b, "2026-01-14", null);
  });
  it("refuses a price ≤ 0 and a range that ends before it starts", async () => {
    const id = await insertSubscription();
    await expect(insertPrice(id, "2026-01-14", null, "0.00")).rejects.toThrow(
      /subscription_prices_amount_positive_check/,
    );
    await expect(insertPrice(id, "2026-02-01", "2026-01-31")).rejects.toThrow(
      /subscription_prices_valid_range_check/,
    );
  });
  it("goes with its subscription", async () => {
    const id = await insertSubscription();
    await insertPrice(id, "2026-01-14", null);
    await admin.query("DELETE FROM subscriptions WHERE id = $1", [id]);
    const r = await admin.query("SELECT count(*)::int AS n FROM subscription_prices");
    expect(r.rows[0].n).toBe(0);
  });
});

describe("subscription_pauses", () => {
  it("needs a note and a range in order", async () => {
    const id = await insertSubscription();
    const q = `INSERT INTO subscription_pauses (tenant_id, subscription_id, from_date, to_date, note, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)`;
    await admin.query(q, [tenantId, id, "2026-07-01", "2026-08-31", "summer", user]);
    await expect(
      admin.query(q, [tenantId, id, "2026-07-01", "2026-06-30", "x", user]),
    ).rejects.toThrow(/subscription_pauses_range_check/);
    await expect(
      admin.query(q, [tenantId, id, "2026-07-01", "2026-07-31", " ", user]),
    ).rejects.toThrow(/subscription_pauses_note_check/);
  });
});

describe("links — occurrence_of", () => {
  const link = (fromId: string, toId: string) =>
    admin.query(
      `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
       VALUES ($1, 'expense', $2, 'subscription', $3, 'occurrence_of', $4)`,
      [tenantId, fromId, toId, user],
    );
  it("is an accepted kind, at most once per entity", async () => {
    const a = await insertSubscription();
    const b = await insertSubscription();
    const expense = randomUUID();
    await link(expense, a);
    await expect(link(expense, b)).rejects.toThrow(/links_occurrence_of_entity_key/);
    await link(randomUUID(), a); // a subscription has many occurrences
  });
});

describe("RLS", () => {
  it("another tenant sees none of the three tables", async () => {
    const id = await insertSubscription();
    await insertPrice(id, "2026-01-14", null);
    const other = (await createTestTenant(admin)).id;
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL app.tenant_id = '${other}'`);
      for (const t of ["subscriptions", "subscription_prices", "subscription_pauses"]) {
        const r = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
        expect(r.rows[0].n).toBe(0);
      }
      await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      const own = await client.query("SELECT count(*)::int AS n FROM subscriptions");
      expect(own.rows[0].n).toBe(1);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
