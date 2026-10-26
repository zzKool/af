// Global search (F93): invoices — exact key, partial text, the amount formats, tenant isolation, the role wall.
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
import { searchInvoiceHits } from "./search";

const adminPool = new Pool({
  connectionString:
    process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test",
});
let a: SearchFixture;
let b: SearchFixture;

beforeAll(async () => {
  await cleanupTestData(adminPool);
  // two tenants with the same keys, names and amounts — only the ids differ
  a = await seedSearchFixture(adminPool, "INV1");
  b = await seedSearchFixture(adminPool, "INV1");
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

async function search(f: SearchFixture, q: string, role: Role = "owner"): Promise<SearchGroup> {
  const result = await withTenantTransaction(prisma, f.tenantId, (tx) =>
    searchInvoiceHits(tx, callerOf(f, role), q),
  );
  if (!result.data) throw new Error(result.error.message);
  return result.data;
}

const ids = (g: SearchGroup) => g.hits.map((h) => h.id);

describe("searchInvoiceHits", () => {
  it("finds an invoice by its exact number, first, with its deep link and client", async () => {
    const g = await search(a, a.keys.invoice.toLowerCase());
    expect(g.hits[0]).toMatchObject({
      id: a.ids.invoice,
      key: a.keys.invoice,
      rank: RANK.exactKey,
      href: `/invoices/${a.ids.invoice}`,
      amount: "1250.00",
      currency: "CHF",
    });
    expect(g.hits[0].label).toContain(a.keys.partnerName);
    expect(g.seeAllHref).toBe(`/invoices?q=${encodeURIComponent(a.keys.invoice.toLowerCase())}`);
  });

  it("finds by a part of the number and by the period label (a draft has no number)", async () => {
    expect(ids(await search(a, "23-INV"))).toEqual([a.ids.invoice]);
    expect(ids(await search(a, "may 2023"))).toEqual([a.ids.draftInvoice]);
  });

  it.each(AMOUNT_FORMATS)("finds the issued invoice and the draft by the amount %s", async (q) => {
    expect(ids(await search(a, q)).sort()).toEqual([a.ids.invoice, a.ids.draftInvoice].sort());
  });

  it("never finds another tenant's invoice", async () => {
    const all = [
      ...ids(await search(b, b.keys.invoice)),
      ...ids(await search(b, "1250")),
      ...ids(await search(b, "2023")),
    ];
    expect(all).not.toContain(a.ids.invoice);
    expect(all).not.toContain(a.ids.draftInvoice);
    expect(all).toContain(b.ids.invoice);
  });

  it("gives the accountant the invoices, a role without the right nothing", async () => {
    expect(ids(await search(a, a.keys.invoice, "accountant"))).toEqual([a.ids.invoice]);
    expect((await search(a, a.keys.invoice, "editor")).hits).toEqual([]);
  });

  it("returns nothing under two characters", async () => {
    expect((await search(a, "S")).hits).toEqual([]);
  });
});
