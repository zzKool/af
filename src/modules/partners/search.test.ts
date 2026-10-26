// Global search (F93): partners — exact key, partial text, the amount formats, tenant isolation, the role wall.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import { RANK, type SearchGroup } from "@/kernel/search/types";
import {
  callerOf,
  type SearchFixture,
  seedSearchFixture,
} from "@/kernel/test-utils/search-fixtures";
import { searchPartnerHits } from "./search";

const adminPool = new Pool({
  connectionString:
    process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test",
});
let a: SearchFixture;
let b: SearchFixture;

beforeAll(async () => {
  await cleanupTestData(adminPool);
  // two tenants with the same keys, names and amounts — only the ids differ
  a = await seedSearchFixture(adminPool, "PRT1");
  b = await seedSearchFixture(adminPool, "PRT1");
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

async function search(f: SearchFixture, q: string, role: Role = "owner"): Promise<SearchGroup> {
  const result = await withTenantTransaction(prisma, f.tenantId, (tx) =>
    searchPartnerHits(tx, callerOf(f, role), q),
  );
  if (!result.data) throw new Error(result.error.message);
  return result.data;
}

const ids = (g: SearchGroup) => g.hits.map((h) => h.id);

describe("searchPartnerHits", () => {
  it("finds a partner by its exact short code, first, with its page", async () => {
    const g = await search(a, a.keys.shortCode.toLowerCase());
    expect(g.hits[0]).toMatchObject({
      id: a.ids.partner,
      key: a.keys.shortCode,
      label: a.keys.partnerName,
      rank: RANK.exactKey,
      href: `/partners/${a.ids.partner}`,
    });
  });

  it("finds by a part of the name, accents and case aside", async () => {
    expect(ids(await search(a, "searchable consult"))).toEqual([a.ids.partner]);
  });

  it("has no amount: an amount finds no partner", async () => {
    expect((await search(a, "1 250")).hits).toEqual([]);
  });

  it("never finds another tenant's partner", async () => {
    const found = ids(await search(b, b.keys.partnerName));
    expect(found).toEqual([b.ids.partner]);
    expect(found).not.toContain(a.ids.partner);
  });

  it("gives the accountant the partners too", async () => {
    expect(ids(await search(a, a.keys.shortCode, "accountant"))).toEqual([a.ids.partner]);
  });
});
