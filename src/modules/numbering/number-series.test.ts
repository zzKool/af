// number_series on the real database: gap-free under concurrency, rollback-safe, tenant-isolated.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createTestTenant } from "@/kernel/db/test-fixtures";
import { nextInSeries, peekSeries } from "./number-series";

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;
let tenantId: string;
let otherTenantId: string;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  tenantId = (await createTestTenant(adminPool)).id;
  otherTenantId = (await createTestTenant(adminPool)).id;
});

const take = (tenant: string, series: string) =>
  withTenantTransaction(prisma, tenant, (tx) => nextInSeries(tx, { tenantId: tenant }, series));

describe("nextInSeries", () => {
  it("starts at 1 and counts up, one series at a time", async () => {
    expect(await take(tenantId, "VA26")).toBe(1);
    expect(await take(tenantId, "VA26")).toBe(2);
    expect(await take(tenantId, "QUO26")).toBe(1);
    expect(await take(tenantId, "VA26")).toBe(3);
  });

  it("concurrent issuers get consecutive numbers — no gaps, no duplicates", async () => {
    const N = 25;
    const numbers = await Promise.all(Array.from({ length: N }, () => take(tenantId, "VA26")));
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it("a rolled-back transaction hands its number back", async () => {
    expect(await take(tenantId, "VA26")).toBe(1);
    await expect(
      withTenantTransaction(prisma, tenantId, async (tx) => {
        const n = await nextInSeries(tx, { tenantId }, "VA26");
        expect(n).toBe(2);
        throw new Error("validation failed after taking the number");
      }),
    ).rejects.toThrow(/validation failed/);
    expect(await take(tenantId, "VA26")).toBe(2);
  });

  it("series are per tenant (RLS)", async () => {
    expect(await take(tenantId, "VA26")).toBe(1);
    expect(await take(tenantId, "VA26")).toBe(2);
    expect(await take(otherTenantId, "VA26")).toBe(1);
    const other = await withTenantTransaction(prisma, otherTenantId, (tx) =>
      peekSeries(tx, "VA26"),
    );
    expect(other.data?.nextValue).toBe(2);
  });

  it("peekSeries reads without taking", async () => {
    const fresh = await withTenantTransaction(prisma, tenantId, (tx) => peekSeries(tx, "VA26"));
    expect(fresh.data).toMatchObject({
      series: "VA26",
      nextValue: 1,
      lastIssued: 0,
      updatedAt: null,
    });
    await take(tenantId, "VA26");
    const after = await withTenantTransaction(prisma, tenantId, (tx) => peekSeries(tx, "VA26"));
    expect(after.data).toMatchObject({ nextValue: 2, lastIssued: 1 });
    expect(await take(tenantId, "VA26")).toBe(2);
  });

  it("rejects a series key that is not a plain identifier", async () => {
    await expect(take(tenantId, "VA 26; drop")).rejects.toThrow(/Invalid series key/);
  });
});
