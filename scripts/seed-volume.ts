// A volume tenant for measuring reads at real-life size (F93: the global search) — invented data only (D51).
//   DATABASE_MIGRATION_URL=postgresql://af:test@localhost:5433/af_test npx tsx scripts/seed-volume.ts
// Creates (or recreates) the tenant "Volume AB" with ~3 years of activity:
//   60 partners · 150 invoices · 300 supplier invoices · 800 expenses · 40 settlements · 2 400 documents · 1 600 bank rows
// Its own tenant: the dev seed and the e2e data stay untouched. Runs as the migration role (RLS bypassed).
// Prints the tenant id — `scripts/measure-search.ts` takes it.
import { Pool } from "pg";

export const VOLUME_TENANT_ID = "00000000-0000-4000-8000-00000000f093";
const USER_ID = "00000000-0000-4000-8000-0000000f0930";

const MERCHANTS = [
  "SPOTIFY",
  "GITHUB",
  "MICROSOFT AZURE",
  "SBB CFF FFS",
  "SAS SCANDINAVIAN",
  "HOTEL BELLEVUE",
  "COOP PRONTO",
  "MIGROS",
  "TAXI LAUSANNE",
  "ADOBE",
  "TELIA",
  "ICA NARA",
  "SWISSCOM",
  "AIRBNB",
  "UBER",
  "PRESSBYRAN",
];

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_TEST_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL (the superuser URL) is required");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const t = VOLUME_TENANT_ID;
  const u = USER_ID;
  try {
    await client.query("BEGIN");
    // recreate: children first (RESTRICT FKs), then the tenant cascades the rest
    for (const table of [
      "settlements",
      "expenses",
      "supplier_invoices",
      "bank_transactions",
      "bank_imports",
      "bank_accounts",
      "payment_sources",
      "expense_groups",
      "invoices",
      "documents",
      "partners",
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [t]);
    }
    await client.query("DELETE FROM tenants WHERE id = $1", [t]);
    await client.query(
      "INSERT INTO tenants (id, name, updated_at) VALUES ($1, 'Volume AB', NOW())",
      [t],
    );

    // 60 partners: short codes P001… (the first 20 are clients)
    await client.query(
      `INSERT INTO partners (tenant_id, name, short_code, types, created_by, updated_at)
       SELECT $1, 'Volume Partner ' || lpad(i::text, 3, '0') || CASE WHEN i % 3 = 0 THEN ' GmbH' ELSE ' AB' END,
              'P' || lpad(i::text, 3, '0'), CASE WHEN i <= 20 THEN '{client}'::text[] ELSE '{vendor}'::text[] END, $2, NOW()
       FROM generate_series(1, 60) i`,
      [t, u],
    );
    // 150 invoices over 3 years for the 20 clients: P001{yy}-INV-nnn
    await client.query(
      `INSERT INTO invoices (tenant_id, type, status, number, partner_id, issue_date, currency, period_label,
         subtotal, net_amount, total_amount, created_by, updated_at)
       SELECT $1, 'invoice', 'issued',
              p.short_code || to_char(d, 'YY') || '-INV-' || lpad(i::text, 3, '0'),
              p.id, d, (ARRAY['CHF','EUR','SEK'])[1 + i % 3], to_char(d, 'FMMonth YYYY'),
              18000 + i * 10, 18000 + i * 10, 18000 + i * 10, $2, NOW()
       FROM generate_series(1, 150) i
       CROSS JOIN LATERAL (SELECT DATE '2023-04-30' + (i * 7) AS d) dd
       JOIN LATERAL (SELECT id, short_code FROM partners WHERE tenant_id = $1 AND types @> '{client}'
                     ORDER BY short_code OFFSET (i % 20) LIMIT 1) p ON true`,
      [t, u],
    );
    await client.query(
      `INSERT INTO expense_groups (tenant_id, number, description, created_by, updated_at)
       SELECT $1, g, 'Volume group ' || g, $2, NOW() FROM generate_series(201, 236) g`,
      [t, u],
    );
    // 300 supplier invoices: SI{group}-Acc-nn, the supplier's own number 9000+i
    await client.query(
      `INSERT INTO supplier_invoices (tenant_id, group_id, key, seq, alias, partner_id, invoice_number, invoice_date,
         due_date, currency, amount_net, vat_amount, amount_total, amount_base, rate, rate_source, bas_code, created_by, updated_at)
       SELECT $1, g.id, 'SI' || g.number || '-Acc-' || lpad(((i - 1) / 36 + 1)::text, 2, '0'), (i - 1) / 36 + 1, 'Acc',
              p.id, (9000 + i)::text, DATE '2023-04-01' + i * 3, DATE '2023-04-01' + i * 3 + 30, 'SEK',
              400 + i, 100, 500 + i, 500 + i, 1, 'same_currency', '6530', $2, NOW()
       FROM generate_series(1, 300) i
       JOIN LATERAL (SELECT id, number FROM expense_groups WHERE tenant_id = $1 ORDER BY number OFFSET ((i - 1) % 36) LIMIT 1) g ON true
       JOIN LATERAL (SELECT id FROM partners WHERE tenant_id = $1 AND types @> '{vendor}' ORDER BY short_code OFFSET (i % 40) LIMIT 1) p ON true`,
      [t, u],
    );
    const source = await client.query<{ id: string }>(
      `INSERT INTO payment_sources (tenant_id, label, kind, currency, created_by, updated_at)
       VALUES ($1, 'Private card', 'private', 'SEK', $2, NOW()) RETURNING id`,
      [t, u],
    );
    // 800 expenses: Ex{group}-Tr-nn, merchants from the list
    await client.query(
      `INSERT INTO expenses (tenant_id, group_id, key, seq, alias, date, description, bas_code, amount, currency,
         amount_base, rate, rate_source, payment_source_id, created_by, updated_at)
       SELECT $1, g.id, 'Ex' || g.number || '-Tr-' || lpad(((i - 1) / 36 + 1)::text, 2, '0'), (i - 1) / 36 + 1, 'Tr',
              DATE '2023-04-01' + i, 'Expense ' || i, '5800', 20 + (i % 400), 'CHF', (20 + (i % 400)) * 11, 11,
              'ecb_daily', $3, $2, NOW()
       FROM generate_series(1, 800) i
       JOIN LATERAL (SELECT id, number FROM expense_groups WHERE tenant_id = $1 ORDER BY number OFFSET ((i - 1) % 36) LIMIT 1) g ON true`,
      [t, u, source.rows[0].id],
    );
    await client.query(
      `UPDATE expenses SET description = initcap(($2::text[])[1 + (seq * 7 + length(key)) % array_length($2::text[], 1)]) || ' ' || key
       WHERE tenant_id = $1`,
      [t, MERCHANTS],
    );

    // the bank: one account, one import, 1 600 rows (4 merchants a day-ish), signed amounts
    const format = await client.query<{ id: string }>("SELECT id FROM bank_formats LIMIT 1");
    if (!format.rows[0]) throw new Error("no bank format — run the seed first");
    const account = await client.query<{ id: string }>(
      `INSERT INTO bank_accounts (tenant_id, account_number, currency, bank_format_id, created_by)
       VALUES ($1, 'VOLUME-0001', 'SEK', $2, $3) RETURNING id`,
      [t, format.rows[0].id, u],
    );
    const imp = await client.query<{ id: string }>(
      `INSERT INTO bank_imports (tenant_id, bank_account_id, file_name, created_by, updated_at)
       VALUES ($1, $2, 'volume.csv', $3, NOW()) RETURNING id`,
      [t, account.rows[0].id, u],
    );
    const bank = await client.query<{ id: string }>(
      `INSERT INTO bank_transactions (tenant_id, bank_account_id, bank_import_id, booking_date, amount, currency, name,
         message, description, counterparty_key, dedup_hash, row_index, created_by)
       SELECT $1, $2, $3, DATE '2023-04-01' + (i * 2 / 3), CASE WHEN i % 9 = 0 THEN 9000 + i ELSE -(15 + (i % 700)) END, 'SEK',
              'Kortköp ' || m, CASE WHEN i % 5 = 0 THEN 'Ref ' || (9000 + i % 300) ELSE NULL END,
              'KORTKÖP ' || m || ' ' || i, m, md5(i::text) || md5('v' || i::text), i, $4
       FROM generate_series(1, 1600) i
       CROSS JOIN LATERAL (SELECT ($5::text[])[1 + i % array_length($5::text[], 1)] AS m) mm
       RETURNING id`,
      [t, account.rows[0].id, imp.rows[0].id, u, MERCHANTS],
    );
    // 40 settlements on the incoming rows: ST{yy}-nnn
    await client.query(
      `INSERT INTO settlements (tenant_id, number, bank_transaction_id, payment_source_id, refund_amount, refund_currency,
         refund_base, allocated_base, created_by, updated_at)
       SELECT $1, 'ST' || to_char(b.booking_date, 'YY') || '-' || lpad(row_number() OVER (ORDER BY b.booking_date)::text, 3, '0'),
              b.id, $2, b.amount, 'SEK', b.amount, b.amount, $3, NOW()
       FROM (SELECT id, booking_date, amount FROM bank_transactions WHERE tenant_id = $1 AND amount > 0
             ORDER BY booking_date LIMIT 40) b`,
      [t, source.rows[0].id, u],
    );
    // 2 400 documents: provisional upload keys and file names
    await client.query(
      `INSERT INTO documents (tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type,
         document_type, created_by, created_at, updated_at)
       SELECT $1, (ARRAY['exp','inv','rec'])[1 + i % 3] || '_' || to_char(DATE '2023-04-01' + i / 2, 'YYYYMMDD') || '_' || lpad(i::text, 4, '0'),
              lower(($3::text[])[1 + i % array_length($3::text[], 1)]) || '-' || i || '.pdf',
              'https://blob.invalid/' || i, 'application/pdf', 1000, 'exp',
              CASE WHEN i % 20 = 0 THEN 'relationship' ELSE 'financial' END, $2,
              (DATE '2023-04-01' + i / 2)::timestamptz, NOW()
       FROM generate_series(1, 2400) i`,
      [t, u, MERCHANTS],
    );
    await client.query("COMMIT");
    await client.query("ANALYZE");
    console.log(
      `Volume AB ${t}: ${bank.rowCount} bank rows, 2400 documents, 800 expenses, 300 supplier invoices`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
