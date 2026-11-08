// The F114 migration (`20261027200100_link_payment_record`, specs/linking/payment-record.md US2) replayed on a
// throw-away database: every migration before it, then today's records — payment sources, a cross-currency
// attachment (one link in the paid currency, the entity's base replaced by the row's), a partial payment, two
// receipts on one row, a settlement with its lines, a `rate_source = bank` invoice with no ECB rate for its day —
// then the migration itself. What it must do: make the private instruments bank accounts, point every expense
// and subscription at its payer, give every allocating link its base (the cross-currency one rewritten into the
// entity's currency in full), give the entities their base back at their date (or keep the realised base as a
// manual rate), turn the settlement lines into `settles` links, drop what duplicated the link, keep the two
// invariants in Postgres, and refuse to run when a record breaks them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const SCRATCH_DB = "af_payment_record_migration_test";
const ENUM_MIGRATION = "20261027200000_owner_private_role";
const MIGRATION = "20261027200100_link_payment_record";
const DIR = join(process.cwd(), "prisma", "migrations");

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const ACC_SEK = "44444444-4444-4444-8444-444444444441";
const IMP = "55555555-5555-4555-8555-555555555555";
const ROW_CARD = "66666666-6666-4666-8666-666666666661"; // −531.40 SEK, the 45 CHF receipt on the SEK card
const ROW_DEPOSIT = "66666666-6666-4666-8666-666666666662"; // −4 000 SEK, a deposit on a 12 000 invoice
const ROW_TWO = "66666666-6666-4666-8666-666666666663"; // −200 SEK, two receipts
const ROW_REFUND = "66666666-6666-4666-8666-666666666664"; // −1 400 SEK, refunds the owner
const SRC_AF_SEK = "77777777-7777-4777-8777-777777777771";
const SRC_PRIVATE = "77777777-7777-4777-8777-777777777772";
const PARTNER = "88888888-8888-4888-8888-888888888888";
const GROUP = "99999999-9999-4999-8999-999999999999";
const E_CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const E_COFFEE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const E_PENS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const E_TAXI = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"; // private, 999.70 SEK
const E_HOTEL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5"; // private, 400 SEK
const SI_BIG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"; // 12 000 SEK
const SI_BANK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"; // 100 CHF, rate_source bank, no ECB rate for its day
const SETTLEMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUBSCRIPTION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
  db.on("error", () => {});
  for (const name of migrationsBefore(ENUM_MIGRATION)) await db.query(migrationSql(name));
  // the enum value must be committed before the migration that uses it (its own file for that reason)
  await db.query(migrationSql(ENUM_MIGRATION));
}

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

/** Today's records: the seven cases of the spec, as the old model stored them. */
async function fixture() {
  await q(`INSERT INTO tenants (id, name, updated_at) VALUES ($1, 'Payment Record AB', now())`, [
    T,
  ]);
  await q(
    `INSERT INTO users (id, email, updated_at) VALUES ($1, 'owner@payment-record.test', now())`,
    [U],
  );
  const fmt = (await q(`SELECT id FROM bank_formats ORDER BY created_at LIMIT 1`)).rows[0]
    ?.id as string;
  await q(
    `INSERT INTO bank_accounts (id, tenant_id, account_alias, account_number, currency, bank_format_id, created_by)
     VALUES ($1, $2, 'Plusgirokonto SEK', '123 45 67-8', 'SEK', $3, $4)`,
    [ACC_SEK, T, fmt, U],
  );
  await q(
    `INSERT INTO bank_imports (id, tenant_id, bank_account_id, file_name, created_by, updated_at)
     VALUES ($1, $2, $3, 'march.csv', $4, now())`,
    [IMP, T, ACC_SEK, U],
  );
  await q(
    `INSERT INTO partners (id, tenant_id, name, created_by, updated_at) VALUES ($1, $2, 'Byteform AB', $3, now())`,
    [PARTNER, T, U],
  );
  await q(
    `INSERT INTO expense_groups (id, tenant_id, number, description, created_by, updated_at)
     VALUES ($1, $2, 213, 'March', $3, now())`,
    [GROUP, T, U],
  );
  await q(
    `INSERT INTO payment_sources (id, tenant_id, label, kind, bank_account_id, currency, created_by, updated_at)
     VALUES ($1, $3, 'AF SEK', 'bank_account', $4, 'SEK', $5, now()),
            ($2, $3, 'Private SE', 'private', NULL, 'SEK', $5, now())`,
    [SRC_AF_SEK, SRC_PRIVATE, T, ACC_SEK, U],
  );
  // the ECB table knows the card receipt's day (2026-03-04) — not the bank-rated invoice's (2026-03-20)
  await q(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ('2026-03-04', 'EUR/SEK', 11.0), ('2026-03-04', 'EUR/CHF', 0.95)`,
  );
  await q(
    `INSERT INTO bank_transactions (id, tenant_id, bank_account_id, bank_import_id, booking_date, amount, currency,
       description, counterparty_key, dedup_hash, row_index, amount_base, rate, rate_source, created_by)
     VALUES ($1, $5, $6, $7, '2026-03-05', -531.40, 'SEK', 'Kortköp SBB', 'SBB', repeat('a', 64), 0, -531.40, 1, 'same_currency', $8),
            ($2, $5, $6, $7, '2026-03-10', -4000.00, 'SEK', 'CONFERENCE DEPOSIT', 'CONFERENCE', repeat('b', 64), 1, -4000.00, 1, 'same_currency', $8),
            ($3, $5, $6, $7, '2026-03-21', -200.00, 'SEK', 'Kortköp SHOP', 'SHOP', repeat('c', 64), 2, -200.00, 1, 'same_currency', $8),
            ($4, $5, $6, $7, '2026-03-31', -1400.00, 'SEK', 'Zikrija', 'ZIKRIJA', repeat('d', 64), 3, -1400.00, 1, 'same_currency', $8)`,
    [ROW_CARD, ROW_DEPOSIT, ROW_TWO, ROW_REFUND, T, ACC_SEK, IMP, U],
  );
  await q(
    `INSERT INTO expenses (id, tenant_id, group_id, key, seq, alias, date, description, bas_code, amount, currency,
       amount_base, rate, rate_source, rate_date, base_provisional, paid_amount, paid_currency, payment_source_id, created_by, updated_at)
     VALUES ($1, $6, $7, 'Ex213-Tr-01', 1, 'Tr', '2026-03-04', 'SBB ticket', '580', 45.00, 'CHF', 531.40, 1, 'bank', NULL, false, 531.40, 'SEK', $8, $10, now()),
            ($2, $6, $7, 'Ex213-Tr-02', 2, 'Tr', '2026-03-21', 'Coffee', '580', 120.00, 'SEK', 120.00, 1, 'same_currency', NULL, false, 120.00, 'SEK', $8, $10, now()),
            ($3, $6, $7, 'Ex213-Tr-03', 3, 'Tr', '2026-03-21', 'Pens', '580', 80.00, 'SEK', 80.00, 1, 'same_currency', NULL, false, 80.00, 'SEK', $8, $10, now()),
            ($4, $6, $7, 'Ex213-Tr-04', 4, 'Tr', '2026-03-12', 'Taxi', '580', 999.70, 'SEK', 999.70, 1, 'same_currency', NULL, false, NULL, NULL, $9, $10, now()),
            ($5, $6, $7, 'Ex213-Tr-05', 5, 'Tr', '2026-03-13', 'Hotel', '580', 400.00, 'SEK', 400.00, 1, 'same_currency', NULL, false, NULL, NULL, $9, $10, now())`,
    [E_CARD, E_COFFEE, E_PENS, E_TAXI, E_HOTEL, T, GROUP, SRC_AF_SEK, SRC_PRIVATE, U],
  );
  await q(
    `INSERT INTO supplier_invoices (id, tenant_id, group_id, key, seq, alias, partner_id, invoice_number, invoice_date,
       due_date, currency, amount_net, vat_amount, amount_total, amount_base, rate, rate_source, bas_code, created_by, updated_at)
     VALUES ($1, $3, $4, 'SI213-Acc-01', 1, 'Acc', $5, '9160', '2026-03-01', '2026-03-31', 'SEK', 9600, 2400, 12000, 12000, 1, 'same_currency', '6530', $6, now()),
            ($2, $3, $4, 'SI213-Acc-02', 2, 'Acc', $5, '9161', '2026-03-20', '2026-04-19', 'CHF', 80, 20, 100, 1150.00, 1, 'bank', '6530', $6, now())`,
    [SI_BIG, SI_BANK, T, GROUP, PARTNER, U],
  );
  await q(
    `INSERT INTO settlements (id, tenant_id, number, bank_transaction_id, payment_source_id, refund_amount, refund_currency,
       refund_base, allocated_base, rounding_base, created_by, updated_at)
     VALUES ($1, $2, 'ST26-001', $3, $4, -1400.00, 'SEK', 1400.00, 1399.70, 0.30, $5, now())`,
    [SETTLEMENT, T, ROW_REFUND, SRC_PRIVATE, U],
  );
  await q(
    `INSERT INTO settlement_lines (tenant_id, settlement_id, expense_id, allocated_base, note, created_by)
     VALUES ($1, $2, $3, 999.70, NULL, $5), ($1, $2, $4, 400.00, 'Rounding adjustment: SEK 0.30', $5)`,
    [T, SETTLEMENT, E_TAXI, E_HOTEL, U],
  );
  await q(
    `INSERT INTO subscriptions (id, tenant_id, name, partner_id, becomes, bas_code, group_id, payment_source_id,
       cadence, start_date, created_by, updated_at)
     VALUES ($1, $2, 'Train pass', $3, 'expense', '580', $4, $5, 'monthly', '2026-01-01', $6, now())`,
    [SUBSCRIPTION, T, PARTNER, GROUP, SRC_PRIVATE, U],
  );
  // the links of the old model: the cross-currency attachment in the PAID currency, the deposit, the two receipts,
  // the settles link that pointed at the settlement itself
  await q(
    `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, allocated_amount, currency, created_by, created_at)
     VALUES ($1, 'bank_transaction', $2, 'expense', $6, 'justifies', 531.40, 'SEK', $11, '2026-03-05T10:00:00Z'),
            ($1, 'bank_transaction', $3, 'supplier_invoice', $9, 'justifies', 4000.00, 'SEK', $11, '2026-03-10T10:00:00Z'),
            ($1, 'bank_transaction', $4, 'expense', $7, 'justifies', 120.00, 'SEK', $11, '2026-03-21T10:00:00Z'),
            ($1, 'bank_transaction', $4, 'expense', $8, 'justifies', 80.00, 'SEK', $11, '2026-03-21T10:00:01Z'),
            ($1, 'bank_transaction', $5, 'settlement', $10, 'settles', 1400.00, 'SEK', $11, '2026-03-31T10:00:00Z')`,
    [
      T,
      ROW_CARD,
      ROW_DEPOSIT,
      ROW_TWO,
      ROW_REFUND,
      E_CARD,
      E_COFFEE,
      E_PENS,
      SI_BIG,
      SETTLEMENT,
      U,
    ],
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

describe("link_payment_record (F114 US2)", () => {
  it("the seven cases move once: payers, bases on the links, the entities' own base, settles links, the invariants", async () => {
    await freshSchema();
    await fixture();

    await db.query(migrationSql(MIGRATION));

    // 1. the private instrument is a bank account with no format; the payers point at accounts
    const privates = await q(
      `SELECT id, account_alias, account_number, currency, role::text, bank_format_id FROM bank_accounts WHERE role = 'owner_private'`,
    );
    expect(privates.rows).toMatchObject([
      {
        account_alias: "Private SE",
        account_number: "Private SE",
        currency: "SEK",
        role: "owner_private",
        bank_format_id: null,
      },
    ]);
    const privateId = privates.rows[0]?.id as string;
    const payers = await q(`SELECT key, paid_from_account_id FROM expenses ORDER BY seq`);
    expect(payers.rows.map((r) => [r.key, r.paid_from_account_id])).toEqual([
      ["Ex213-Tr-01", ACC_SEK],
      ["Ex213-Tr-02", ACC_SEK],
      ["Ex213-Tr-03", ACC_SEK],
      ["Ex213-Tr-04", privateId],
      ["Ex213-Tr-05", privateId],
    ]);
    expect(
      (await q(`SELECT paid_from_account_id FROM subscriptions WHERE id = $1`, [SUBSCRIPTION]))
        .rows[0]?.paid_from_account_id,
    ).toBe(privateId);

    // 2. the links: the cross-currency attachment in the entity's currency with the row's whole base; same-currency
    //    slices pro rata, the two receipts summing to the row's base; the settlement lines as settles links
    const links = await q(
      `SELECT from_id, to_type, to_id, kind, allocated_amount::text, currency, allocated_base::text, note
         FROM links ORDER BY created_at, allocated_amount DESC`,
    );
    expect(links.rows).toEqual([
      {
        from_id: ROW_CARD,
        to_type: "expense",
        to_id: E_CARD,
        kind: "justifies",
        allocated_amount: "45.00",
        currency: "CHF",
        allocated_base: "531.40",
        note: null,
      },
      {
        from_id: ROW_DEPOSIT,
        to_type: "supplier_invoice",
        to_id: SI_BIG,
        kind: "justifies",
        allocated_amount: "4000.00",
        currency: "SEK",
        allocated_base: "4000.00",
        note: null,
      },
      {
        from_id: ROW_TWO,
        to_type: "expense",
        to_id: E_COFFEE,
        kind: "justifies",
        allocated_amount: "120.00",
        currency: "SEK",
        allocated_base: "120.00",
        note: null,
      },
      {
        from_id: ROW_TWO,
        to_type: "expense",
        to_id: E_PENS,
        kind: "justifies",
        allocated_amount: "80.00",
        currency: "SEK",
        allocated_base: "80.00",
        note: null,
      },
      {
        from_id: ROW_REFUND,
        to_type: "expense",
        to_id: E_TAXI,
        kind: "settles",
        allocated_amount: "999.70",
        currency: "SEK",
        allocated_base: "999.70",
        note: null,
      },
      {
        from_id: ROW_REFUND,
        to_type: "expense",
        to_id: E_HOTEL,
        kind: "settles",
        allocated_amount: "400.00",
        currency: "SEK",
        allocated_base: "400.00",
        note: "Rounding adjustment: SEK 0.30",
      },
    ]);
    expect(
      (await q(`SELECT count(*)::int AS n FROM links WHERE to_type = 'settlement'`)).rows[0]?.n,
    ).toBe(0);
    // the audit trail says what the migration did
    const trail = await q(
      `SELECT action, count(*)::int AS n FROM audit_logs WHERE entity_type = 'link' AND source = 'migration' GROUP BY action ORDER BY action`,
    );
    expect(trail.rows).toEqual([
      { action: "create", n: 2 },
      { action: "delete", n: 1 },
    ]);

    // 3. the entities' base at their date: the card receipt back on the ECB (11.0 ÷ 0.95 = 11.578947 → 521.05);
    //    the bank-rated invoice with no rate for its day keeps its realised base as a manual rate
    const card = (
      await q(
        `SELECT amount_base::text, rate::text, rate_source::text, rate_date::text FROM expenses WHERE id = $1`,
        [E_CARD],
      )
    ).rows[0];
    expect(card).toEqual({
      amount_base: "521.05",
      rate: "11.578947",
      rate_source: "ecb_daily",
      rate_date: "2026-03-04",
    });
    const invoice = (
      await q(
        `SELECT amount_base::text, rate::text, rate_source::text, rate_date::text FROM supplier_invoices WHERE id = $1`,
        [SI_BANK],
      )
    ).rows[0];
    expect(invoice).toEqual({
      amount_base: "1150.00",
      rate: "11.500000",
      rate_source: "manual",
      rate_date: "2026-03-20",
    });

    // 4. what duplicated the link is gone
    const columns = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN ('expenses', 'supplier_invoices', 'settlements', 'subscriptions')
          AND column_name IN ('paid_amount', 'paid_currency', 'base_provisional', 'payment_source_id', 'refund_amount', 'refund_base', 'allocated_base', 'exchange_difference_base', 'rounding_base', 'exchange_difference_bas_code')`,
    );
    expect(columns.rows).toEqual([]);
    const tables = await q(
      `SELECT table_name FROM information_schema.tables WHERE table_name IN ('payment_sources', 'settlement_lines')`,
    );
    expect(tables.rows).toEqual([]);
    expect(
      (await q(`SELECT number, bank_transaction_id, status::text FROM settlements`)).rows,
    ).toEqual([{ number: "ST26-001", bank_transaction_id: ROW_REFUND, status: "active" }]);

    // 5. the invariants in Postgres: an allocation over the entity's amount, one over the row's base, a money
    //    change on a linked expense or invoice — refused by name; the owner's facts still move
    await expect(
      q(
        `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, allocated_amount, currency, allocated_base, created_by)
         VALUES ($1, 'bank_transaction', $2, 'supplier_invoice', $3, 'justifies', 8000.01, 'SEK', 1, $4)`,
        [T, ROW_REFUND, SI_BIG, U],
      ),
    ).rejects.toThrow(/link_allocation_exceeded/);
    await expect(
      q(
        `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, allocated_amount, currency, allocated_base, created_by)
         VALUES ($1, 'bank_transaction', $2, 'supplier_invoice', $3, 'justifies', 1.00, 'SEK', 0.31, $4)`,
        [T, ROW_REFUND, SI_BIG, U],
      ),
    ).rejects.toThrow(/link_allocation_exceeded/);
    await expect(q(`UPDATE expenses SET amount = 46 WHERE id = $1`, [E_CARD])).rejects.toThrow(
      /expense_locked/,
    );
    await expect(
      q(`UPDATE expenses SET paid_from_account_id = $2 WHERE id = $1`, [E_TAXI, ACC_SEK]),
    ).rejects.toThrow(/expense_locked/);
    await expect(
      q(`UPDATE supplier_invoices SET amount_total = 12001 WHERE id = $1`, [SI_BIG]),
    ).rejects.toThrow(/supplier_invoice_locked/);
    await q(`UPDATE supplier_invoices SET amount_total = 101, amount_net = 81 WHERE id = $1`, [
      SI_BANK,
    ]); // unlinked: open
    await q(`UPDATE expenses SET note = 'free', bas_code = '583' WHERE id = $1`, [E_CARD]);
    await expect(
      q(`UPDATE expenses SET rate_source = 'bank' WHERE id = $1`, [E_TAXI]),
    ).rejects.toThrow(/expense_locked|rate_source_check/);
    // the remainder of the refund row, 0.30, is what the lines did not take — the row's base is intact
    const used = (
      await q(`SELECT sum(allocated_base)::text AS base FROM links WHERE from_id = $1`, [
        ROW_REFUND,
      ])
    ).rows[0];
    expect(used?.base).toBe("1399.70");
  });

  it("refuses to run when a payment source points at no account — nothing changed", async () => {
    await freshSchema();
    await fixture();
    await q(`UPDATE payment_sources SET bank_account_id = gen_random_uuid() WHERE id = $1`, [
      SRC_AF_SEK,
    ]);
    await expect(db.query(migrationSql(MIGRATION))).rejects.toThrow(
      /payment source\(s\) point at no bank account — nothing changed: AF SEK/,
    );
    // the transaction rolled back: the old columns are still there
    const cols = await q(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'paid_amount'`,
    );
    expect(cols.rows).toHaveLength(1);
  });
});
