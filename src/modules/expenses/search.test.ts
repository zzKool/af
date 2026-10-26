// Global search (F93): expenses and settlements — exact key, partial text, the amount formats, tenant isolation, the role wall.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import { RANK, type SearchGroup } from "@/kernel/search/types";
import {
  AMOUNT_FORMATS,
  callerOf,
  type SearchFixture,
  seedSearchFixture,
} from "@/kernel/test-utils/search-fixtures";
import { searchExpenseHits, searchSettlementHits } from "./search";

const adminPool = new Pool({
  connectionString:
    process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test",
});
let a: SearchFixture;
let b: SearchFixture;

beforeAll(async () => {
  await cleanupTestData(adminPool);
  // two tenants with the same keys, names and amounts — only the ids differ
  a = await seedSearchFixture(adminPool, "EXP1");
  b = await seedSearchFixture(adminPool, "EXP1");
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

async function search(f: SearchFixture, q: string, role: Role = "owner"): Promise<SearchGroup> {
  const result = await withTenantTransaction(prisma, f.tenantId, (tx) =>
    searchExpenseHits(tx, callerOf(f, role), q),
  );
  if (!result.data) throw new Error(result.error.message);
  return result.data;
}

const ids = (g: SearchGroup) => g.hits.map((h) => h.id);

async function settlements(f: SearchFixture, q: string, role: Role = "owner") {
  const result = await withTenantTransaction(prisma, f.tenantId, (tx) =>
    searchSettlementHits(tx, callerOf(f, role), q),
  );
  if (!result.data) throw new Error(result.error.message);
  return result.data;
}

describe("searchExpenseHits", () => {
  it("finds an expense by its exact key, first, with the panel's deep link", async () => {
    const g = await search(a, a.keys.expense.toLowerCase());
    expect(g.hits[0]).toMatchObject({
      id: a.ids.expense,
      key: a.keys.expense,
      label: a.keys.expenseDescription,
      rank: RANK.exactKey,
      href: `/expenses?open=${a.ids.expense}`,
      amount: "1250.00",
      currency: "EUR",
    });
  });

  it("finds by a part of the description", async () => {
    expect(ids(await search(a, "taxi laus"))).toEqual([a.ids.expense]);
  });

  it.each(AMOUNT_FORMATS)("finds it by the amount %s", async (q) => {
    expect(ids(await search(a, q))).toEqual([a.ids.expense]);
  });

  it("never finds another tenant's expense", async () => {
    const found = [...ids(await search(b, b.keys.expense)), ...ids(await search(b, "1250"))];
    expect(found).not.toContain(a.ids.expense);
    expect(found).toContain(b.ids.expense);
  });

  it("gives the accountant the expenses too", async () => {
    expect(ids(await search(a, a.keys.expense, "accountant"))).toEqual([a.ids.expense]);
  });
});

describe("searchSettlementHits", () => {
  it("finds a settlement by its exact number, with its page", async () => {
    const g = await settlements(a, a.keys.settlement);
    expect(g.hits[0]).toMatchObject({
      id: a.ids.settlement,
      key: a.keys.settlement,
      rank: RANK.exactKey,
      href: `/expenses/settlements/${a.ids.settlement}`,
      amount: "1250.00",
    });
    expect(g.hits[0].label).toBe("Private card");
  });

  it("finds by a part of the number and by the refund amount", async () => {
    expect(ids(await settlements(a, "ST23"))).toEqual([a.ids.settlement]);
    for (const q of AMOUNT_FORMATS)
      expect(ids(await settlements(a, q))).toEqual([a.ids.settlement]);
  });

  it("never finds another tenant's settlement", async () => {
    const found = ids(await settlements(b, b.keys.settlement));
    expect(found).toEqual([b.ids.settlement]);
  });

  it("gives the accountant the settlements, a role without the right nothing", async () => {
    expect(ids(await settlements(a, a.keys.settlement, "accountant"))).toEqual([a.ids.settlement]);
    expect((await settlements(a, a.keys.settlement, "editor")).hits).toEqual([]);
  });
});
