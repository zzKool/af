// The T025 migration's backfill (`20261110130000_expense_group_month`): the batch groups today's proposal found by
// their name get the month as a fact, once — the cases `monthOfGroupName` answered before it retired (an ISO month
// anywhere, an English month or its start with the year; a group number, a year alone, an impossible month are not
// months); a trip group and a group with a month already are left alone; a second run changes nothing. The DO block
// is read from the migration file itself and run on the test database (the column exists there already).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestData, createTestTenant, createTestUser } from "@/kernel/db/test-fixtures";

const ADMIN_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const SQL = readFileSync(
  join(
    process.cwd(),
    "prisma",
    "migrations",
    "20261110130000_expense_group_month",
    "migration.sql",
  ),
  "utf8",
);
/** the backfill alone — the column and its check exist on the test database */
const BACKFILL = SQL.slice(SQL.indexOf("DO $$"));

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: ADMIN_URL });
});
beforeEach(async () => {
  await cleanupTestData(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("T025 — expense_groups.month backfilled from today's names, once", () => {
  it("the names the proposal read become the fact; the rest stays null; trips and set months untouched; idempotent", async () => {
    const tenant = await createTestTenant(pool);
    const user = await createTestUser(pool);
    const cases: [description: string, kind: "batch" | "trip", month: string | null][] = [
      ["2026-07 card purchases", "batch", null],
      ["Receipts 2026-11", "batch", null],
      ["July 2026", "batch", null],
      ["Sep. 2026 expenses", "batch", null],
      ["Mar 2026", "batch", null],
      ["Travel to CH in March 2026", "batch", null],
      ["213 — Switzerland", "batch", null],
      ["2026-13 nonsense", "batch", null],
      ["Budget 2026", "batch", null],
      ["Licences", "batch", null],
      ["Switzerland, March 2026", "trip", null],
      ["2026-05 but set by hand", "batch", "2026-06"],
    ];
    let n = 1;
    for (const [description, kind, month] of cases)
      await pool.query(
        `INSERT INTO expense_groups (tenant_id, number, description, kind, month, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [tenant.id, n++, description, kind, month, user.id],
      );
    const read = async () =>
      Object.fromEntries(
        (
          await pool.query<{ description: string; month: string | null }>(
            "SELECT description, month FROM expense_groups WHERE tenant_id = $1",
            [tenant.id],
          )
        ).rows.map((r) => [r.description, r.month]),
      );

    await pool.query(BACKFILL);
    expect(await read()).toEqual({
      "2026-07 card purchases": "2026-07",
      "Receipts 2026-11": "2026-11",
      "July 2026": "2026-07",
      "Sep. 2026 expenses": "2026-09",
      "Mar 2026": "2026-03",
      "Travel to CH in March 2026": "2026-03",
      "213 — Switzerland": null,
      "2026-13 nonsense": null,
      "Budget 2026": null,
      Licences: null,
      "Switzerland, March 2026": null,
      "2026-05 but set by hand": "2026-06",
    });
    const before = await read();
    await pool.query(BACKFILL);
    expect(await read()).toEqual(before);
  });

  it("the column refuses a value that is not a month", async () => {
    const tenant = await createTestTenant(pool);
    const user = await createTestUser(pool);
    await expect(
      pool.query(
        `INSERT INTO expense_groups (tenant_id, number, description, month, created_by, updated_at)
         VALUES ($1, 1, 'x', '2026-13', $2, NOW())`,
        [tenant.id, user.id],
      ),
    ).rejects.toThrow(/expense_groups_month_check/);
  });
});
