// D68 (F148): after the migration the chart is at four digits and nothing points at a three-digit code — the
// accounts, their groups and parents, every column that keeps a code, and the chart still read-only.
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const admin = new Pool({
  connectionString:
    process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test",
});
afterAll(() => admin.end());

const one = async (sql: string) => (await admin.query(sql)).rows[0];

describe("the four-digit chart (D68)", () => {
  it("every account has four digits, a group of its class (BAS's 30 covers 30–34), and a sub-account its main account", async () => {
    expect(
      await one(`SELECT count(*)::int AS n FROM bas_categories WHERE code !~ '^[0-9]{4}$'`),
    ).toEqual({ n: 0 });
    expect(
      await one(`SELECT count(*)::int AS n FROM bas_categories WHERE kind = 'main'`),
    ).toMatchObject({
      n: expect.any(Number),
    });
    expect(
      await one(`SELECT count(*)::int AS n FROM bas_categories c
                  LEFT JOIN bas_categories p ON p.code = c.parent_code
                  WHERE c.kind = 'sub' AND c.parent_code IS NOT NULL AND (p.code IS NULL OR p.kind <> 'main')`),
    ).toEqual({ n: 0 });
    expect(
      await one(`SELECT count(*)::int AS n FROM bas_categories c
                  WHERE left(c.code, 1) <> left(c.group_code, 1) OR left(c.code, 2) < c.group_code
                     OR left(c.code, 1)::int <> c.class_num`),
    ).toEqual({ n: 0 });
    // the accounts the app names in code exist (the no-proof reasons, the default rules, the mock's answer)
    const named = ["2510", "6540", "6570", "7210", "8310"];
    const found = await admin.query(
      `SELECT code FROM bas_categories WHERE code = ANY($1) ORDER BY code`,
      [named],
    );
    expect(found.rows.map((r) => r.code)).toEqual(named);
  });

  it("every account has an English name — the ones BAS does not give are the agent's, marked ` **` (F149)", async () => {
    expect(
      await one(`SELECT count(*)::int AS n FROM bas_categories WHERE name_en IS NULL`),
    ).toEqual({ n: 0 });
    const marked = await one(
      `SELECT count(*)::int AS n FROM bas_categories WHERE name_en LIKE '% **'`,
    );
    expect(marked.n).toBeGreaterThan(0);
    expect(await one(`SELECT name_en FROM bas_categories WHERE code = '1214'`)).toEqual({
      name_en: "Computers (for production) **",
    });
  });

  it("no column keeps a three-digit code", async () => {
    for (const [table, column] of [
      ["bank_transactions", "bas_code"],
      ["categorisation_rules", "bas_code"],
      ["expenses", "bas_code"],
      ["journal_entries", "bas_code"],
      ["subscriptions", "bas_code"],
      ["supplier_invoices", "bas_code"],
      ["supplier_invoice_lines", "bas_code"],
      ["tenant_bas_preferences", "bas_code"],
      ["partners", "default_bas_category_code"],
    ]) {
      const r = await one(`SELECT count(*)::int AS n FROM ${table} WHERE length(${column}) = 3`);
      expect({ table, ...r }).toEqual({ table, n: 0 });
    }
  });

  it("the chart and its groups stay read-only (the rules are back)", async () => {
    const rules = await admin.query(
      `SELECT rulename FROM pg_rules WHERE tablename = 'bas_categories' ORDER BY rulename`,
    );
    expect(rules.rows.map((r) => r.rulename)).toEqual([
      "no_delete_bas",
      "no_insert_bas",
      "no_update_bas",
    ]);
    const grants = await admin.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'bas_groups' AND grantee = 'af_app' ORDER BY 1`,
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
  });
});
