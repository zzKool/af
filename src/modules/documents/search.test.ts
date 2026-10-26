// Global search (F93): documents — exact key, partial text, the amount formats, tenant isolation, the role wall.
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
import { searchDocumentHits } from "./search";

const adminPool = new Pool({
  connectionString:
    process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test",
});
let a: SearchFixture;
let b: SearchFixture;

beforeAll(async () => {
  await cleanupTestData(adminPool);
  // two tenants with the same keys, names and amounts — only the ids differ
  a = await seedSearchFixture(adminPool, "DOC1");
  b = await seedSearchFixture(adminPool, "DOC1");
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

async function search(f: SearchFixture, q: string, role: Role = "owner"): Promise<SearchGroup> {
  const result = await withTenantTransaction(prisma, f.tenantId, (tx) =>
    searchDocumentHits(tx, callerOf(f, role), q),
  );
  if (!result.data) throw new Error(result.error.message);
  return result.data;
}

const ids = (g: SearchGroup) => g.hits.map((h) => h.id);

describe("searchDocumentHits", () => {
  it("finds a document by its exact business key, first, with its review page", async () => {
    const g = await search(a, a.keys.financialDocument.toUpperCase());
    expect(g.hits[0]).toMatchObject({
      id: a.ids.financialDocument,
      key: a.keys.financialDocument,
      label: "taxi-receipt.pdf",
      rank: RANK.exactKey,
      href: `/documents/${a.ids.financialDocument}`,
    });
  });

  it("finds by a part of the key and by the file name", async () => {
    expect(ids(await search(a, "20230412")).sort()).toEqual(
      [a.ids.financialDocument, a.ids.relationshipDocument].sort(),
    );
    expect(ids(await search(a, "taxi-rec"))).toEqual([a.ids.financialDocument]);
  });

  it("has no amount: an amount finds no document", async () => {
    expect((await search(a, "1'250")).hits).toEqual([]);
  });

  it("never finds another tenant's document", async () => {
    const found = ids(await search(b, "20230412"));
    expect(found).not.toContain(a.ids.financialDocument);
    expect(found).not.toContain(a.ids.relationshipDocument);
    expect(found).toContain(b.ids.financialDocument);
  });

  it("gives the accountant the financial documents only", async () => {
    expect(ids(await search(a, "20230412", "accountant"))).toEqual([a.ids.financialDocument]);
    expect((await search(a, a.keys.relationshipDocument, "accountant")).hits).toEqual([]);
  });
});
