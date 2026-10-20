// The reference ListQuery implementation on the real database: paging, sorting, every filter kind,
// search, Excel-semantics distinct values and date hierarchy — all under RLS.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createTestPartner,
  createTestTenant,
  createTestUser,
} from "@/kernel/db/test-fixtures";
import type { ListQuery } from "@/kernel/list-query/types";
import { distinctPartnerValues, listPartners, partnerDateHierarchy } from "./queries";

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;
let tenantId: string;
let otherTenantId: string;

const q = (over: Partial<ListQuery> = {}): ListQuery => ({
  page: 1,
  pageSize: 25,
  sort: [],
  filters: {},
  ...over,
});

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
  const userId = (await createTestUser(adminPool)).id;
  const seed = [
    { name: "Valtech", types: ["client"], defaultCurrency: "CHF", orgNumber: "CHE-1" },
    { name: "Xylo", types: ["client"], defaultCurrency: "SEK", orgNumber: "559-1" },
    { name: "Lufthansa", types: ["vendor"], defaultCurrency: "EUR", orgNumber: undefined },
    { name: "SJ AB", types: ["vendor"], defaultCurrency: "SEK", orgNumber: "556-1" },
    {
      name: "Old GmbH",
      types: ["client", "vendor"],
      defaultCurrency: undefined,
      orgNumber: undefined,
      isActive: false,
    },
  ];
  for (const p of seed) await createTestPartner(adminPool, tenantId, userId, p);
  await createTestPartner(adminPool, otherTenantId, userId, { name: "Foreign", types: ["client"] });
});

const list = (query: ListQuery) =>
  withTenantTransaction(prisma, tenantId, (tx) => listPartners(tx, query));

describe("listPartners", () => {
  it("pages and sorts by the default (name asc); never sees another tenant", async () => {
    const page1 = await list(q({ pageSize: 25 }));
    expect(page1.total).toBe(5);
    expect(page1.rows.map((r) => r.name)).toEqual([
      "Lufthansa",
      "Old GmbH",
      "SJ AB",
      "Valtech",
      "Xylo",
    ]);
    const page2 = await list(q({ pageSize: 2, page: 2 }));
    expect(page2.rows.map((r) => r.name)).toEqual(["SJ AB", "Valtech"]);
    expect(page2.total).toBe(5);
  });

  it("filters: in on an array column, in with blanks, text ops, boolean, search", async () => {
    expect(
      (await list(q({ filters: { types: { kind: "in", values: ["vendor"] } } }))).rows.map(
        (r) => r.name,
      ),
    ).toEqual(["Lufthansa", "Old GmbH", "SJ AB"]);
    expect(
      (
        await list(q({ filters: { defaultCurrency: { kind: "in", values: ["CHF", null] } } }))
      ).rows.map((r) => r.name),
    ).toEqual(["Old GmbH", "Valtech"]);
    expect(
      (await list(q({ filters: { orgNumber: { kind: "text", op: "empty" } } }))).rows.map(
        (r) => r.name,
      ),
    ).toEqual(["Lufthansa", "Old GmbH"]);
    expect(
      (await list(q({ filters: { name: { kind: "text", op: "startsWith", value: "x" } } }))).total,
    ).toBe(1);
    expect(
      (await list(q({ filters: { isActive: { kind: "in", values: ["false"] } } }))).rows[0].name,
    ).toBe("Old GmbH");
    expect((await list(q({ search: "556" }))).rows.map((r) => r.name)).toEqual(["SJ AB"]);
  });

  it("filters: dates by year / month / range on createdAt", async () => {
    const year = new Date().getUTCFullYear();
    expect(
      (await list(q({ filters: { createdAt: { kind: "dates", years: [year] } } }))).total,
    ).toBe(5);
    expect(
      (await list(q({ filters: { createdAt: { kind: "dates", years: [year - 1] } } }))).total,
    ).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (await list(q({ filters: { createdAt: { kind: "dates", from: today, to: today } } }))).total,
    ).toBe(5);
  });

  it("sorts by a mapped column and a secondary key", async () => {
    const r = await list(
      q({
        sort: [
          { col: "defaultCurrency", dir: "desc" },
          { col: "name", dir: "asc" },
        ],
      }),
    );
    expect(r.rows.map((x) => x.defaultCurrency)).toEqual([null, "SEK", "SEK", "EUR", "CHF"]);
  });
});

describe("distinct values and date hierarchy (Excel semantics)", () => {
  it("counts the column's values over the set filtered by the OTHER columns", async () => {
    const all = await withTenantTransaction(prisma, tenantId, (tx) =>
      distinctPartnerValues(tx, "defaultCurrency", q()),
    );
    expect(all).toEqual([
      { value: "SEK", count: 2 },
      { value: "CHF", count: 1 },
      { value: "EUR", count: 1 },
      { value: null, count: 1 },
    ]);
    const vendorsOnly = await withTenantTransaction(prisma, tenantId, (tx) =>
      distinctPartnerValues(
        tx,
        "defaultCurrency",
        q({ filters: { types: { kind: "in", values: ["vendor"] } } }),
      ),
    );
    expect(vendorsOnly).toEqual([
      { value: "EUR", count: 1 },
      { value: "SEK", count: 1 },
      { value: null, count: 1 },
    ]);
    // the column's own filter does not narrow its own list
    const own = await withTenantTransaction(prisma, tenantId, (tx) =>
      distinctPartnerValues(
        tx,
        "defaultCurrency",
        q({ filters: { defaultCurrency: { kind: "in", values: ["CHF"] } } }),
      ),
    );
    expect(own.length).toBe(4);
  });

  it("unnests the array column and counts booleans as strings", async () => {
    const types = await withTenantTransaction(prisma, tenantId, (tx) =>
      distinctPartnerValues(tx, "types", q()),
    );
    expect(types).toEqual([
      { value: "client", count: 3 },
      { value: "vendor", count: 3 },
    ]);
    const active = await withTenantTransaction(prisma, tenantId, (tx) =>
      distinctPartnerValues(tx, "isActive", q()),
    );
    expect(active).toEqual([
      { value: "true", count: 4 },
      { value: "false", count: 1 },
    ]);
  });

  it("builds the date hierarchy of createdAt", async () => {
    const h = await withTenantTransaction(prisma, tenantId, (tx) =>
      partnerDateHierarchy(tx, "createdAt", q()),
    );
    expect(h.empty).toBe(0);
    expect(h.years).toHaveLength(1);
    expect(h.years[0].count).toBe(5);
    expect(h.years[0].months[0].days[0].count).toBe(5);
    const notADate = await withTenantTransaction(prisma, tenantId, (tx) =>
      partnerDateHierarchy(tx, "name", q()),
    );
    expect(notADate).toEqual({ years: [], empty: 0 });
  });
});
