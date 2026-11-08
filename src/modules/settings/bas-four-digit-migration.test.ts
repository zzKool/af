// D68 (F148): the four-digit migration (`20261108120000_bas_four_digit`) replayed on a throw-away database —
// every migration before it, a tenant with three-digit codes in its preferences, a partner's default and a rule,
// then the migration. What it must do: `NNN` → `NNN0` everywhere, the owner's short code kept, the three-digit rows
// gone; and refuse — naming the code — when a stored code has no four-digit account.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const SCRATCH_DB = "af_bas_four_digit_migration_test";
const MIGRATION = "20261108120000_bas_four_digit";
const DIR = join(process.cwd(), "prisma", "migrations");

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";

function scratchUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}
const migrationsBefore = (name: string) =>
  readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < name)
    .map((d) => d.name)
    .sort();
const migrationSql = (name: string) => readFileSync(join(DIR, name, "migration.sql"), "utf8");

let admin: Pool;
let db: Pool;

async function freshSchema() {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  db = new Pool({ connectionString: scratchUrl(), max: 1 });
  db.on("error", () => {});
  for (const name of migrationsBefore(MIGRATION)) await db.query(migrationSql(name));
}

/** A tenant whose codes are three digits: IT services activated with its short code, a partner's default, a rule. */
async function fixture(ruleCode = "583") {
  await db.query(`INSERT INTO tenants (id, name, updated_at) VALUES ($1, 'Four Digit AB', now())`, [
    T,
  ]);
  await db.query(
    `INSERT INTO users (id, email, updated_at) VALUES ($1, 'owner@four-digit.test', now())`,
    [U],
  );
  await db.query(
    `INSERT INTO tenant_bas_preferences (tenant_id, bas_code, short_code, is_favorite, created_by)
     VALUES ($1, '654', 'IT', true, $2), ($1, '657', NULL, false, $2)`,
    [T, U],
  );
  await db.query(
    `INSERT INTO partners (id, tenant_id, name, default_bas_category_code, created_by, updated_at)
     VALUES ($1, $2, 'Invented Cloud AB', '654', $3, now())`,
    [P, T, U],
  );
  await db.query(
    `INSERT INTO categorisation_rules (tenant_id, name, match_type, match_pattern, bas_code, created_by, updated_at)
     VALUES ($1, 'Invented lunches', 'contains', 'LUNCH', $2, $3, now())`,
    [T, ruleCode, U],
  );
}

beforeAll(() => {
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
});
afterAll(async () => {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.end();
});

describe("bas_four_digit (D68)", () => {
  it("moves every stored code to its four-digit main account and drops the three-digit chart", async () => {
    await freshSchema();
    await fixture();
    await db.query(migrationSql(MIGRATION));

    const prefs = await db.query(
      `SELECT bas_code, short_code, is_favorite FROM tenant_bas_preferences ORDER BY bas_code`,
    );
    expect(prefs.rows).toEqual([
      { bas_code: "6540", short_code: "IT", is_favorite: true },
      { bas_code: "6570", short_code: null, is_favorite: false },
    ]);
    expect((await db.query(`SELECT default_bas_category_code AS c FROM partners`)).rows).toEqual([
      { c: "6540" },
    ]);
    expect((await db.query(`SELECT bas_code AS c FROM categorisation_rules`)).rows).toEqual([
      { c: "5830" },
    ]);
    const chart = await db.query(
      `SELECT count(*) FILTER (WHERE length(code) = 3)::int AS three,
              count(*) FILTER (WHERE kind = 'sub')::int AS subs,
              (SELECT count(*)::int FROM bas_groups) AS groups
         FROM bas_categories`,
    );
    expect(chart.rows[0].three).toBe(0);
    expect(chart.rows[0].subs).toBeGreaterThan(700);
    expect(chart.rows[0].groups).toBeGreaterThan(60);
  });

  it("refuses when a stored code has no four-digit account, naming it — nothing changed", async () => {
    await freshSchema();
    await fixture("999");
    await expect(db.query(migrationSql(MIGRATION))).rejects.toThrow(
      /no four-digit account for the stored code\(s\) 999/,
    );
  });
});
