// The F113 migration (`20261027120000_one_transaction_table`, specs/banking/one-table.md US2) replayed on a
// throw-away database: every migration before it, a tenant with bank rows, their journal entries, links from a
// bank entry and from the row, the entries' audit trail — then the migration itself. What it must do: copy the
// entries' facts onto the rows, re-point the links (a duplicate of the row's own link dropped), append the entries'
// trail onto the rows', lock the bank's facts and the base, refuse to run while a manual entry exists.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const SCRATCH_DB = "af_one_table_migration_test";
const MIGRATION = "20261027120000_one_transaction_table";
const DIR = join(process.cwd(), "prisma", "migrations");

const T = "11111111-1111-4111-8111-111111111111"; // the tenant
const U = "22222222-2222-4222-8222-222222222222"; // the user
const ACC = "44444444-4444-4444-8444-444444444444";
const IMP = "55555555-5555-4555-8555-555555555555";
const ROW_SEK = "66666666-6666-4666-8666-666666666661";
const ROW_CHF = "66666666-6666-4666-8666-666666666662";
const ENTRY_SEK = "77777777-7777-4777-8777-777777777771";
const ENTRY_CHF = "77777777-7777-4777-8777-777777777772";
const PARTNER = "88888888-8888-4888-8888-888888888888";
const DOC = "99999999-9999-4999-8999-999999999999";

function scratchUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

function migrationsBefore(name: string): string[] {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < name)
    .map((d) => d.name)
    .sort();
}

const migrationSql = (name: string) => readFileSync(join(DIR, name, "migration.sql"), "utf8");

let admin: Pool;
let db: Pool;

async function freshSchema() {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  db = new Pool({ connectionString: scratchUrl(), max: 1 });
  // the FORCE drop may terminate a client the pool is still closing — not a finding
  db.on("error", () => {});
  for (const name of migrationsBefore(MIGRATION)) await db.query(migrationSql(name));
}

/** A tenant with two bank rows (SEK, CHF), their entries, a partner, a document and the links. */
async function fixture() {
  await db.query(`INSERT INTO tenants (id, name, updated_at) VALUES ($1, 'One Table AB', now())`, [
    T,
  ]);
  await db.query(
    `INSERT INTO users (id, email, updated_at) VALUES ($1, 'owner@one-table.test', now())`,
    [U],
  );
  // bank_formats is reference data under an INSERT-dropping rule: the migration-seeded format is the one
  const fmt = (await db.query(`SELECT id FROM bank_formats ORDER BY created_at LIMIT 1`)).rows[0]
    ?.id as string;
  await db.query(
    `INSERT INTO bank_accounts (id, tenant_id, account_number, currency, bank_format_id, created_by)
     VALUES ($1, $2, '123 45 67-8', 'SEK', $3, $4)`,
    [ACC, T, fmt, U],
  );
  await db.query(
    `INSERT INTO bank_imports (id, tenant_id, bank_account_id, file_name, created_by, updated_at)
     VALUES ($1, $2, $3, 'one-table.csv', $4, now())`,
    [IMP, T, ACC, U],
  );
  await db.query(
    `INSERT INTO partners (id, tenant_id, name, created_by, updated_at) VALUES ($1, $2, 'Byteform AB', $3, now())`,
    [PARTNER, T, U],
  );
  await db.query(
    `INSERT INTO documents (id, tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type, document_type, created_by, updated_at)
     VALUES ($1, $2, 'Ex213-Tr-01_2026-07-08_', 'receipt.pdf', 'fs://documents/receipt.pdf', 'application/pdf', 10, 'expense', 'financial', $3, now())`,
    [DOC, T, U],
  );
  await db.query(
    `INSERT INTO bank_transactions (id, tenant_id, bank_account_id, bank_import_id, booking_date, amount, currency,
       description, counterparty_key, dedup_hash, row_index, created_by)
     VALUES ($1, $3, $4, $5, '2026-07-03', -132.52, 'SEK', 'Kortköp OPENAI', 'OPENAI', repeat('a', 64), 0, $6),
            ($2, $3, $4, $5, '2026-07-08', -20000.00, 'CHF', 'CHANGE CHFSEK', 'CHANGE CHFSEK', repeat('b', 64), 1, $6)`,
    [ROW_SEK, ROW_CHF, T, ACC, IMP, U],
  );
  await db.query(
    `INSERT INTO journal_entries (id, tenant_id, source_type, source_id, entry_date, description, counterparty_key,
       amount, currency, amount_base, rate, rate_source, rate_date, bas_code, partner_id, note, no_document_needed,
       categorised_by, rule_id, created_by, updated_at)
     VALUES ($1, $3, 'bank_transaction', $4, '2026-07-03', 'Kortköp OPENAI', 'OPENAI', -132.52, 'SEK', -132.52, 1,
             'same_currency', NULL, '654', $6, 'the subscription', false, 'rule', $7, $8, '2026-07-04T10:00:00Z'),
            ($2, $3, 'bank_transaction', $5, '2026-07-08', 'CHANGE CHFSEK', 'CHANGE CHFSEK', -20000.00, 'CHF',
             -237993.14, 11.899657, 'ecb_daily', '2026-07-08', NULL, NULL, NULL, true, 'manual', NULL, $8, '2026-07-09T10:00:00Z')`,
    [ENTRY_SEK, ENTRY_CHF, T, ROW_SEK, ROW_CHF, PARTNER, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", U],
  );
  // the row justifies the document; the entry "justifies" it too (the same fact twice — the migration keeps one)
  // and the entry alone belongs_to the partner (re-pointed to the row)
  await db.query(
    `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, allocated_amount, currency, created_by)
     VALUES ($1, 'bank_transaction', $2, 'document', $4, 'justifies', 132.52, 'SEK', $5),
            ($1, 'journal_entry', $3, 'document', $4, 'justifies', 132.52, 'SEK', $5),
            ($1, 'journal_entry', $3, 'partner', $6, 'belongs_to', NULL, NULL, $5)`,
    [T, ROW_SEK, ENTRY_SEK, DOC, U, PARTNER],
  );
  // the trail: the row's import, the entry's creation (not copied) and its categorisation (copied onto the row)
  await db.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data, source, created_at)
     VALUES ($1, $2, 'create', 'bank_transaction', $3, NULL, '{"amount":"-132.52"}', 'web', '2026-07-03T12:00:00Z'),
            ($1, $2, 'create', 'journal_entry', $4, NULL, '{"basCode":null}', 'web', '2026-07-03T12:00:01Z'),
            ($1, $2, 'update', 'journal_entry', $4, '{"basCode":null,"partnerId":null,"noDocumentNeeded":false}',
             '{"basCode":"654","partnerId":"${PARTNER}","noDocumentNeeded":false,"categorisedBy":"rule"}', 'system', '2026-07-04T10:00:00Z')`,
    [T, U, ROW_SEK, ENTRY_SEK],
  );
}

beforeAll(async () => {
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
});

afterAll(async () => {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.end();
});

describe("one_transaction_table (F113 US2)", () => {
  it("copies the entries' facts onto the rows, re-points the links, appends the trail, locks the facts", async () => {
    await freshSchema();
    await fixture();

    await db.query(migrationSql(MIGRATION));

    const rows = await db.query(
      `SELECT id, amount_base::text, rate::text, rate_source::text, rate_date::text, bas_code, partner_id, note,
              no_document_needed, categorised_by::text, rule_id, updated_at
         FROM bank_transactions ORDER BY row_index`,
    );
    expect(rows.rows).toMatchObject([
      {
        id: ROW_SEK,
        amount_base: "-132.52",
        rate: "1.000000",
        rate_source: "same_currency",
        rate_date: null,
        bas_code: "654",
        partner_id: PARTNER,
        note: "the subscription",
        no_document_needed: false,
        categorised_by: "rule",
        rule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        id: ROW_CHF,
        amount_base: "-237993.14",
        rate: "11.899657",
        rate_source: "ecb_daily",
        rate_date: "2026-07-08",
        bas_code: null,
        partner_id: null,
        no_document_needed: true,
        categorised_by: "manual",
      },
    ]);
    expect(rows.rows[0]?.updated_at.toISOString()).toBe("2026-07-04T10:00:00.000Z");

    // the links: one justifies from the row (the entry's duplicate dropped), the belongs_to re-pointed
    const links = await db.query(
      `SELECT from_type, from_id, to_type, kind FROM links ORDER BY kind, to_type`,
    );
    expect(links.rows).toEqual([
      { from_type: "bank_transaction", from_id: ROW_SEK, to_type: "partner", kind: "belongs_to" },
      { from_type: "bank_transaction", from_id: ROW_SEK, to_type: "document", kind: "justifies" },
    ]);

    // the trail: the categorisation is on the row now (the old rows untouched)
    const trail = await db.query(
      `SELECT action, entity_type, entity_id, new_data->>'basCode' AS bas, created_at
         FROM audit_logs WHERE entity_type = 'bank_transaction' ORDER BY created_at`,
    );
    expect(trail.rows.map((r) => [r.action, r.entity_id, r.bas])).toEqual([
      ["create", ROW_SEK, null],
      ["update", ROW_SEK, "654"],
    ]);
    expect(trail.rows[1]?.created_at.toISOString()).toBe("2026-07-04T10:00:00.000Z");
    expect(
      (
        await db.query(
          `SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'journal_entry'`,
        )
      ).rows[0]?.n,
    ).toBe(2);

    // the lock: the bank's facts and the base refuse; the owner's facts pass
    for (const set of [
      "amount = 1",
      "amount_base = 1",
      "rate = 2",
      "booking_date = '2026-01-01'",
    ]) {
      await expect(
        db.query(`UPDATE bank_transactions SET ${set} WHERE id = $1`, [ROW_SEK]),
      ).rejects.toThrow(/bank_transaction_locked/);
    }
    await db.query(
      `UPDATE bank_transactions SET bas_code = '657', note = NULL, no_document_needed = true, categorised_by = 'manual', rule_id = NULL WHERE id = $1`,
      [ROW_SEK],
    );
    // the row is the bank: `bank` is no rate source of a row
    await expect(
      db.query(`UPDATE bank_transactions SET rate_source = 'bank' WHERE id = $1`, [ROW_SEK]),
    ).rejects.toThrow(/bank_transaction_locked/);
    await expect(
      db.query(
        `INSERT INTO bank_transactions (tenant_id, bank_account_id, bank_import_id, booking_date, amount, currency,
           description, counterparty_key, dedup_hash, row_index, amount_base, rate, rate_source, created_by)
         VALUES ($1, $2, $3, '2026-07-09', -1, 'SEK', 'x', 'X', repeat('c', 64), 2, -1, 1, 'bank', $4)`,
        [T, ACC, IMP, U],
      ),
    ).rejects.toThrow(/bank_transactions_rate_source_check/);
    // the partner is a foreign key (D63)
    await expect(
      db.query(`UPDATE bank_transactions SET partner_id = $2 WHERE id = $1`, [ROW_SEK, DOC]),
    ).rejects.toThrow(/bank_transactions_partner_fkey/);
    // the old table is still there, read by nothing (PR B)
    expect((await db.query(`SELECT count(*)::int AS n FROM journal_entries`)).rows[0]?.n).toBe(2);
    // the old immutable trigger is gone, the lock is in place
    const triggers = await db.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'bank_transactions'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers.rows.map((r) => r.tgname)).toEqual([
      "bank_transactions_block_delete_when_linked",
      "bank_transactions_lock_facts",
    ]);
  });

  it("refuses to run while a manual entry exists — named, nothing changed", async () => {
    await freshSchema();
    await fixture();
    await db.query(
      `INSERT INTO journal_entries (id, tenant_id, source_type, source_id, entry_date, description, amount, currency,
         amount_base, rate, rate_source, created_by, updated_at)
       VALUES (gen_random_uuid(), $1, 'manual', NULL, '2026-03-01', 'Prepaid hosting 2026', -1200.00, 'SEK', -1200.00, 1,
               'same_currency', $2, now())`,
      [T, U],
    );

    await expect(db.query(migrationSql(MIGRATION))).rejects.toThrow(
      /manual journal entries exist.*2026-03-01 Prepaid hosting 2026 \(SEK -1200\.00\)/,
    );
    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_transactions' AND column_name = 'amount_base'`,
    );
    expect(columns.rows).toEqual([]);
    expect(
      (await db.query(`SELECT count(*)::int AS n FROM links WHERE from_type = 'journal_entry'`))
        .rows[0]?.n,
    ).toBe(2);
  });
});
