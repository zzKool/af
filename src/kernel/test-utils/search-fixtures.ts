// One of each searchable entity in a tenant, written by SQL as the superuser (RLS bypassed, like the kernel's
// other factories) — for the modules' `search.test.ts` (F93). Invented data only (D51).
// Every tenant seeded with the same `stamp` gets the same keys, names and amounts: a search in one tenant must
// return that tenant's ids and never the other's.
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { CallerIdentity, Role } from "@/kernel/auth/caller-identity";

export type SearchFixture = {
  tenantId: string;
  userId: string;
  ids: {
    partner: string;
    invoice: string;
    draftInvoice: string;
    supplierInvoice: string;
    expense: string;
    settlement: string;
    financialDocument: string;
    relationshipDocument: string;
    bankTransaction: string;
  };
  /** what the tests type */
  keys: {
    partnerName: string;
    shortCode: string;
    invoice: string;
    supplierInvoice: string;
    supplierNumber: string;
    expense: string;
    expenseDescription: string;
    settlement: string;
    financialDocument: string;
    relationshipDocument: string;
    bankText: string;
  };
  /** the one amount every entity carries (bank row: negative) */
  amount: "1250.00";
};

export function callerOf(f: SearchFixture, role: Role = "owner"): CallerIdentity {
  return { userId: f.userId, tenantId: f.tenantId, role, source: "web" };
}

async function anyBankFormat(pool: Pool): Promise<string> {
  const found = await pool.query<{ id: string }>("SELECT id FROM bank_formats LIMIT 1");
  if (found.rows[0]) return found.rows[0].id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO bank_formats (name, bank_name, delimiter, decimal_separator, date_format, encoding, column_mapping)
     VALUES ('Test format', 'Test bank', ';', ',', 'yyyy/MM/dd', 'utf-8', '{}') RETURNING id`,
  );
  return created.rows[0].id;
}

/** `stamp`: 4 upper-case letters / digits, shared by the tenants that must look alike. */
export async function seedSearchFixture(pool: Pool, stamp: string): Promise<SearchFixture> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const ids = {
    partner: randomUUID(),
    invoice: randomUUID(),
    draftInvoice: randomUUID(),
    supplierInvoice: randomUUID(),
    expense: randomUUID(),
    settlement: randomUUID(),
    financialDocument: randomUUID(),
    relationshipDocument: randomUUID(),
    bankTransaction: randomUUID(),
  };
  const shortCode = `S${stamp}`.slice(0, 6);
  const keys = {
    partnerName: `Searchable Consulting ${stamp} AB`,
    shortCode,
    invoice: `${shortCode}23-INV-001`,
    supplierInvoice: `SI901-Acc-01`,
    supplierNumber: `SUP-${stamp}-77`,
    expense: `Ex901-Tr-01`,
    expenseDescription: `Taxi Lausanne ${stamp}`,
    settlement: `ST23-901`,
    financialDocument: `exp_20230412_${stamp}`,
    relationshipDocument: `rel_20230412_${stamp}`,
    bankText: `KORTKOP SPOTIFY ${stamp}`,
  };
  const q = (sql: string, params: unknown[]) => pool.query(sql, params);

  await q("INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())", [
    tenantId,
    `Search ${stamp} ${tenantId.slice(0, 4)}`,
  ]);
  await q(
    `INSERT INTO partners (id, tenant_id, name, short_code, types, created_by, updated_at)
     VALUES ($1, $2, $3, $4, '{client,vendor}', $5, NOW())`,
    [ids.partner, tenantId, keys.partnerName, shortCode, userId],
  );
  // an issued invoice and a draft, both 1250.00 CHF
  await q(
    `INSERT INTO invoices (id, tenant_id, type, status, number, partner_id, issue_date, currency, period_label,
       subtotal, net_amount, total_amount, created_by, updated_at)
     VALUES ($1, $2, 'invoice', 'issued', $3, $4, '2023-04-30', 'CHF', 'April 2023', 1250, 1250, 1250, $5, NOW()),
            ($6, $2, 'invoice', 'draft', NULL, $4, '2023-05-31', 'CHF', 'May 2023', 1250, 1250, 1250, $5, NOW())`,
    [ids.invoice, tenantId, keys.invoice, ids.partner, userId, ids.draftInvoice],
  );
  const group = randomUUID();
  await q(
    `INSERT INTO expense_groups (id, tenant_id, number, description, created_by, updated_at)
     VALUES ($1, $2, 901, 'Search group', $3, NOW())`,
    [group, tenantId, userId],
  );
  await q(
    `INSERT INTO supplier_invoices (id, tenant_id, group_id, key, seq, alias, partner_id, invoice_number, invoice_date,
       due_date, currency, amount_net, vat_amount, amount_total, amount_base, rate, rate_source, bas_code, created_by, updated_at)
     VALUES ($1, $2, $3, $4, 1, 'Acc', $5, $6, '2023-04-12', '2023-05-12', 'SEK', 1000, 250, 1250, 1250, 1, 'same_currency',
       '6530', $7, NOW())`,
    [
      ids.supplierInvoice,
      tenantId,
      group,
      keys.supplierInvoice,
      ids.partner,
      keys.supplierNumber,
      userId,
    ],
  );
  const source = randomUUID();
  await q(
    `INSERT INTO payment_sources (id, tenant_id, label, kind, currency, created_by, updated_at)
     VALUES ($1, $2, 'Private card', 'private', 'SEK', $3, NOW())`,
    [source, tenantId, userId],
  );
  await q(
    `INSERT INTO expenses (id, tenant_id, group_id, key, seq, alias, date, description, bas_code, amount, currency,
       amount_base, rate, rate_source, payment_source_id, created_by, updated_at)
     VALUES ($1, $2, $3, $4, 1, 'Tr', '2023-04-12', $5, '5800', 1250, 'EUR', 14000, 11.2, 'ecb_daily', $6, $7, NOW())`,
    [ids.expense, tenantId, group, keys.expense, keys.expenseDescription, source, userId],
  );

  const format = await anyBankFormat(pool);
  const account = randomUUID();
  const imp = randomUUID();
  await q(
    `INSERT INTO bank_accounts (id, tenant_id, account_number, currency, bank_format_id, created_by)
     VALUES ($1, $2, $3, 'SEK', $4, $5)`,
    [account, tenantId, `ACC-${stamp}-${tenantId.slice(0, 4)}`, format, userId],
  );
  await q(
    `INSERT INTO bank_imports (id, tenant_id, bank_account_id, file_name, created_by, updated_at)
     VALUES ($1, $2, $3, 'search.csv', $4, NOW())`,
    [imp, tenantId, account, userId],
  );
  await q(
    `INSERT INTO bank_transactions (id, tenant_id, bank_account_id, bank_import_id, booking_date, amount, currency,
       name, description, counterparty_key, dedup_hash, row_index, amount_base, rate, rate_source, created_by)
     VALUES ($1, $2, $3, $4, '2023-04-13', -1250, 'SEK', $5, $5, 'SPOTIFY', $6, 0, -1250, 1, 'same_currency', $7)`,
    [ids.bankTransaction, tenantId, account, imp, keys.bankText, "a".repeat(64), userId],
  );
  await q(
    `INSERT INTO settlements (id, tenant_id, number, bank_transaction_id, payment_source_id, refund_amount,
       refund_currency, refund_base, allocated_base, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, 1250, 'SEK', 1250, 1250, $6, NOW())`,
    [ids.settlement, tenantId, keys.settlement, ids.bankTransaction, source, userId],
  );
  await q(
    `INSERT INTO documents (id, tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type,
       document_type, created_by, updated_at)
     VALUES ($1, $2, $3, 'taxi-receipt.pdf', 'https://blob.test/a', 'application/pdf', 100, 'exp', 'financial', $4, NOW()),
            ($5, $2, $6, 'nda-signed.pdf', 'https://blob.test/b', 'application/pdf', 100, 'rel', 'relationship', $4, NOW())`,
    [
      ids.financialDocument,
      tenantId,
      keys.financialDocument,
      userId,
      ids.relationshipDocument,
      keys.relationshipDocument,
    ],
  );

  return { tenantId, userId, ids, keys, amount: "1250.00" };
}

/** The amount formats the spec promises — every one must find the 1250.00 entities. */
export const AMOUNT_FORMATS = ["1250", "1 250", "1250.00", "1'250", "1250,00", "1,250.00"] as const;
