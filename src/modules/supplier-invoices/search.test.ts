// Global search (F93): supplier invoices — exact key, partial text, the amount formats, tenant isolation, the role wall.
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
import { searchSupplierInvoiceHits } from "./search";

const adminPool = new Pool({
  connectionString:
    process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test",
});
let a: SearchFixture;
let b: SearchFixture;

beforeAll(async () => {
  await cleanupTestData(adminPool);
  // two tenants with the same keys, names and amounts — only the ids differ
  a = await seedSearchFixture(adminPool, "SUP1");
  b = await seedSearchFixture(adminPool, "SUP1");
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

async function search(f: SearchFixture, q: string, role: Role = "owner"): Promise<SearchGroup> {
  const result = await withTenantTransaction(prisma, f.tenantId, (tx) =>
    searchSupplierInvoiceHits(tx, callerOf(f, role), q),
  );
  if (!result.data) throw new Error(result.error.message);
  return result.data;
}

const ids = (g: SearchGroup) => g.hits.map((h) => h.id);

describe("searchSupplierInvoiceHits", () => {
  it("finds a supplier invoice by its exact key, first, with the panel's deep link and the supplier", async () => {
    const g = await search(a, a.keys.supplierInvoice);
    expect(g.hits[0]).toMatchObject({
      id: a.ids.supplierInvoice,
      key: a.keys.supplierInvoice,
      rank: RANK.exactKey,
      href: `/supplier-invoices?open=${a.ids.supplierInvoice}`,
      amount: "1250.00",
    });
    expect(g.hits[0].label).toBe(`${a.keys.partnerName} · #${a.keys.supplierNumber}`);
  });

  it("finds by the supplier's own number, exact and partial", async () => {
    expect((await search(a, a.keys.supplierNumber)).hits[0]).toMatchObject({
      id: a.ids.supplierInvoice,
      rank: RANK.exactKey,
    });
    expect(ids(await search(a, a.keys.supplierNumber.slice(4, 10)))).toEqual([
      a.ids.supplierInvoice,
    ]);
  });

  it("finds by a part of the key", async () => {
    expect((await search(a, "SI901")).hits[0]).toMatchObject({ rank: RANK.keyPrefix });
  });

  it.each(AMOUNT_FORMATS)("finds it by the amount %s", async (q) => {
    expect(ids(await search(a, q))).toEqual([a.ids.supplierInvoice]);
  });

  it("never finds another tenant's supplier invoice", async () => {
    const found = [
      ...ids(await search(b, b.keys.supplierInvoice)),
      ...ids(await search(b, "1250")),
    ];
    expect(found).not.toContain(a.ids.supplierInvoice);
    expect(found).toContain(b.ids.supplierInvoice);
  });

  it("gives the accountant the supplier invoices, a role without the right nothing", async () => {
    expect(ids(await search(a, a.keys.supplierInvoice, "accountant"))).toEqual([
      a.ids.supplierInvoice,
    ]);
    expect((await search(a, a.keys.supplierInvoice, "editor")).hits).toEqual([]);
  });
});
