// Global search (F93): bank rows — exact key, partial text, the amount formats, tenant isolation, the role wall.
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
import { searchBankTransactionHits } from "./search";

const adminPool = new Pool({
  connectionString:
    process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test",
});
let a: SearchFixture;
let b: SearchFixture;

beforeAll(async () => {
  await cleanupTestData(adminPool);
  // two tenants with the same keys, names and amounts — only the ids differ
  a = await seedSearchFixture(adminPool, "BNK1");
  b = await seedSearchFixture(adminPool, "BNK1");
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

async function search(f: SearchFixture, q: string, role: Role = "owner"): Promise<SearchGroup> {
  const result = await withTenantTransaction(prisma, f.tenantId, (tx) =>
    searchBankTransactionHits(tx, callerOf(f, role), q),
  );
  if (!result.data) throw new Error(result.error.message);
  return result.data;
}

const ids = (g: SearchGroup) => g.hits.map((h) => h.id);

describe("searchBankTransactionHits", () => {
  it("finds a bank row by a part of its text, with the panel's deep link", async () => {
    const g = await search(a, "spotify");
    expect(g.hits[0]).toMatchObject({
      id: a.ids.bankTransaction,
      key: null,
      label: a.keys.bankText,
      date: "2023-04-13",
      amount: "-1250.00",
      currency: "SEK",
      href: `/banking?open=${a.ids.bankTransaction}`,
    });
  });

  it.each([...AMOUNT_FORMATS, "-1250", "−1 250.00"])(
    "finds the outgoing row by the amount %s",
    async (q) => {
      const g = await search(a, q);
      expect(ids(g)).toEqual([a.ids.bankTransaction]);
      expect(g.hits[0].rank).toBe(RANK.amount);
    },
  );

  it("does not take a near amount for the amount", async () => {
    expect((await search(a, "1250.01")).hits).toEqual([]);
  });

  it("never finds another tenant's row", async () => {
    const found = [...ids(await search(b, "spotify")), ...ids(await search(b, "1250"))];
    expect(found).not.toContain(a.ids.bankTransaction);
    expect(found).toContain(b.ids.bankTransaction);
  });

  it("gives the accountant the bank rows too", async () => {
    expect(ids(await search(a, "spotify", "accountant"))).toEqual([a.ids.bankTransaction]);
  });
});
