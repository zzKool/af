// D71 (F124 (6)): the migration `20261030010000_counterparty_key_without_reference` replayed on a throw-away
// database over keys the old rule wrote — the per-transaction reference at the end of a card text — and over the
// rules made from such rows. What it must do: leave every stored key exactly as `counterpartyKey` computes it
// today (the SQL and the TypeScript are the same two expressions), touch nothing else on the row (the lock trigger
// is back after the statement), and cut the rules' patterns the same way. Keys without a reference stay.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { counterpartyKey } from "./counterparty";

const ADMIN_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const SCRATCH_DB = "af_counterparty_key_migration_test";
const MIGRATION = "20261030010000_counterparty_key_without_reference";
const DIR = join(process.cwd(), "prisma", "migrations");

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const ACC = "44444444-4444-4444-8444-444444444441";
const IMP = "55555555-5555-4555-8555-555555555555";

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
const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

/** The texts Nordea gives, with the key the OLD rule derived (the reference kept) — the fixture of the migration. */
const CASES: { details: string; oldKey: string }[] = [
  { details: "Kortköp 260709 MICROSOFT#G169504312", oldKey: "MICROSOFT#G169504312" },
  { details: "Kortköp 260809 MICROSOFT#G170011223", oldKey: "MICROSOFT#G170011223" },
  { details: "Kortköp 260707 MSFT * E0100ZW7M8", oldKey: "MSFT * E0100ZW7M8" },
  { details: "Kortköp 260801 AMZN MKTP SE*2A1BC3DEF", oldKey: "AMZN MKTP SE*2A1BC3DEF" },
  { details: "Kortköp 260727 OPENAI *CHATGPT SUBS", oldKey: "OPENAI *CHATGPT SUBS" },
  { details: "Kortköp 260727 ANTHROPIC* CLAUDE SU", oldKey: "ANTHROPIC* CLAUDE SU" },
  { details: "AVGIFTER NORDEA", oldKey: "AVGIFTER NORDEA" },
  { details: "Kortköp 260709 #G169504312", oldKey: "#G169504312" },
];

beforeAll(async () => {
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  db = new Pool({ connectionString: scratchUrl(), max: 1 });
  db.on("error", () => {});
  for (const name of migrationsBefore(MIGRATION)) await db.query(migrationSql(name));
  await q(`INSERT INTO tenants (id, name, updated_at) VALUES ($1, 'Key AB', now())`, [T]);
  await q(`INSERT INTO users (id, email, updated_at) VALUES ($1, 'owner@key.test', now())`, [U]);
  const fmt = (await q(`SELECT id FROM bank_formats ORDER BY created_at LIMIT 1`)).rows[0]
    ?.id as string;
  await q(
    `INSERT INTO bank_accounts (id, tenant_id, account_alias, account_number, currency, bank_format_id, created_by)
     VALUES ($1, $2, 'Plusgirokonto SEK', '123 45 67-8', 'SEK', $3, $4)`,
    [ACC, T, fmt, U],
  );
  await q(
    `INSERT INTO bank_imports (id, tenant_id, bank_account_id, file_name, created_by, updated_at)
     VALUES ($1, $2, $3, 'july.csv', $4, now())`,
    [IMP, T, ACC, U],
  );
  for (const [i, c] of CASES.entries()) {
    await q(
      `INSERT INTO bank_transactions (tenant_id, bank_account_id, bank_import_id, booking_date, amount, currency,
         description, additional_details, counterparty_key, dedup_hash, row_index, amount_base, rate, rate_source, created_by)
       VALUES ($1, $2, $3, '2026-07-10', -123.88, 'SEK', $4, $4, $5, $6, $7, -123.88, 1, 'same_currency', $8)`,
      [T, ACC, IMP, c.details, c.oldKey, String(i).padStart(64, "0"), i, U],
    );
  }
  await q(
    `INSERT INTO categorisation_rules (tenant_id, name, match_type, match_pattern, match_field, bas_code, created_by, updated_at)
     VALUES ($1, 'from the row', 'contains', 'MICROSOFT#G169504312', 'counterparty_key', '6540', $2, now()),
            ($1, 'fees', 'exact', 'AVGIFTER NORDEA', 'counterparty_key', '6570', $2, now()),
            ($1, 'a regex', 'regex', 'MICROSOFT#G\\d+$', 'counterparty_key', '6540', $2, now()),
            ($1, 'on the text', 'contains', 'MSFT * E0100ZW7M8', 'all', '6540', $2, now())`,
    [T, U],
  );
  await db.query(migrationSql(MIGRATION));
}, 120_000);

afterAll(async () => {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.end();
});

describe("counterparty_key_without_reference (D71)", () => {
  it("every stored key is what counterpartyKey computes today — the SQL and the TypeScript agree", async () => {
    const rows = (
      await q(
        `SELECT additional_details, counterparty_key FROM bank_transactions ORDER BY row_index`,
      )
    ).rows as { additional_details: string; counterparty_key: string }[];
    expect(rows).toHaveLength(CASES.length);
    for (const r of rows) {
      expect(r.counterparty_key).toBe(counterpartyKey({ additionalDetails: r.additional_details }));
    }
    const keys = Object.fromEntries(rows.map((r) => [r.additional_details, r.counterparty_key]));
    expect(keys["Kortköp 260709 MICROSOFT#G169504312"]).toBe("MICROSOFT");
    expect(keys["Kortköp 260809 MICROSOFT#G170011223"]).toBe("MICROSOFT");
    expect(keys["Kortköp 260707 MSFT * E0100ZW7M8"]).toBe("MSFT");
    expect(keys["Kortköp 260801 AMZN MKTP SE*2A1BC3DEF"]).toBe("AMZN MKTP SE");
    expect(keys["Kortköp 260727 OPENAI *CHATGPT SUBS"]).toBe("OPENAI *CHATGPT SUBS");
    expect(keys["Kortköp 260727 ANTHROPIC* CLAUDE SU"]).toBe("ANTHROPIC* CLAUDE SU");
    expect(keys["AVGIFTER NORDEA"]).toBe("AVGIFTER NORDEA");
    expect(keys["Kortköp 260709 #G169504312"]).toBe("UNKNOWN");
  });

  it("the lock trigger is back: the bank's facts are written once", async () => {
    await expect(
      q(`UPDATE bank_transactions SET amount = -1 WHERE counterparty_key = 'AVGIFTER NORDEA'`),
    ).rejects.toThrow(/bank_transaction_locked/);
    // the key itself stays guarded too — only the migration stepped around it
    await expect(
      q(`UPDATE bank_transactions SET counterparty_key = 'X' WHERE counterparty_key = 'MSFT'`),
    ).rejects.toThrow(/bank_transaction_locked/);
  });

  it("the rules made from such rows are cut the same way; a regex, an exact fee rule and a free-text rule are left", async () => {
    const rules = (await q(`SELECT name, match_pattern FROM categorisation_rules ORDER BY name`))
      .rows as { name: string; match_pattern: string }[];
    expect(Object.fromEntries(rules.map((r) => [r.name, r.match_pattern]))).toEqual({
      "a regex": "MICROSOFT#G\\d+$",
      fees: "AVGIFTER NORDEA",
      "from the row": "MICROSOFT",
      "on the text": "MSFT * E0100ZW7M8",
    });
  });
});
