// The F129 migration (`20261104120000_justified_partner`, specs/justify/rework.md US5) replayed on a throw-away
// database: every migration before it, then the fixture of US5 — two tenants, nine rows flagged *no proof needed*
// without a partner (one with a typed one), four no-proof rules, a hand-made *Skatteverket* — then the migration
// itself. What it must do: give every tenant its four partners (a hand-made one of the name takes the role instead
// of a twin), place the rows from their rule's partner else from their account (the tax agency by the account's
// currency), give the no-proof rules the same map, leave an audit row per row touched, log the counts — and change
// nothing on a second run of its data part. The invented names and amounts are the spec's (D51).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "./months"; // loads the module graph in the order the app does (queries alone starts a cycle)
import { deriveTransactionState } from "./queries";

const ADMIN_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
const SCRATCH_DB = "af_justified_partner_migration_test";
const MIGRATION = "20261104120000_justified_partner";
const DIR = join(process.cwd(), "prisma", "migrations");

// tenant A and its owner, tenant B and its owner
const T_A = "11111111-1111-4111-8111-11111111111a";
const T_B = "11111111-1111-4111-8111-11111111111b";
const U_A = "22222222-2222-4222-8222-22222222222a";
const U_B = "22222222-2222-4222-8222-22222222222b";
const ACC_A_SEK = "44444444-4444-4444-8444-4444444444a1";
const ACC_A_CHF = "44444444-4444-4444-8444-4444444444a2";
const ACC_A_SAV = "44444444-4444-4444-8444-4444444444a3";
const ACC_B_SEK = "44444444-4444-4444-8444-4444444444b1";
const IMP_A_SEK = "55555555-5555-4555-8555-5555555555a1";
const IMP_A_CHF = "55555555-5555-4555-8555-5555555555a2";
const IMP_A_SAV = "55555555-5555-4555-8555-5555555555a3";
const IMP_B_SEK = "55555555-5555-4555-8555-5555555555b1";
const P_SKV = "88888888-8888-4888-8888-8888888888a1"; // hand-made Skatteverket, no role
const P_ACME = "88888888-8888-4888-8888-8888888888a2";
const P_BYTEFORM = "88888888-8888-4888-8888-8888888888a3";
const R_FEE_A = "99999999-9999-4999-8999-9999999999a1"; // Nordea bank fees, 657, no partner
const R_INT_A = "99999999-9999-4999-8999-9999999999a2"; // Savings interest, 831, no partner
const R_BYTE_A = "99999999-9999-4999-8999-9999999999a3"; // Byteform refunds, 6540, partner Byteform AG
const R_FEE_B = "99999999-9999-4999-8999-9999999999b1"; // B's fee rule, 657, no partner
const ROW = {
  R1: "66666666-6666-4666-8666-666666666601", // AVGIFTER NORDEA −139.00, 657, the fee rule → the bank
  R2: "66666666-6666-4666-8666-666666666602", // RÄNTA +12.40 on the savings account, 8310, the interest rule → the bank
  R3: "66666666-6666-4666-8666-666666666603", // SKATTEVERKET −31 400.00, 251, by hand → Skatteverket (the hand-made one)
  R4: "66666666-6666-4666-8666-666666666604", // ESTV MWST −2 800.00 CHF, 2510 → the FTA
  R5: "66666666-6666-4666-8666-666666666605", // LÖN −45 000.00, 7210 → the owner
  R6: "66666666-6666-4666-8666-666666666606", // BYTEFORM AG +250.00, 6540, the Byteform rule → Byteform AG (by rule)
  R7: "66666666-6666-4666-8666-666666666607", // MISC −99.00, 6540, no rule → stays NULL, re-opens
  R8: "66666666-6666-4666-8666-666666666608", // AVGIFTER NORDEA −139.00 with Acme typed → untouched
  R9: "66666666-6666-4666-8666-666666666609", // B: AVGIFTER NORDEA −95.00, 657, B's fee rule → B's bank
} as const;

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
/** the migration's RAISE NOTICE lines — the box's log says the same */
const notices: string[] = [];

async function freshSchema() {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  db = new Pool({ connectionString: scratchUrl(), max: 1 });
  // the FORCE drop may terminate a client the pool is still closing — not a finding
  db.on("error", () => {});
  db.on("connect", (client) => {
    client.on("notice", (n) => {
      if (n.message?.startsWith("justified_partner:")) notices.push(n.message);
    });
  });
  for (const name of migrationsBefore(MIGRATION)) await db.query(migrationSql(name));
}

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function tenant(id: string, name: string, userId: string, userName: string, email: string) {
  await q(`INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, now())`, [id, name]);
  await q(`INSERT INTO organizations (id, name, slug, updated_at) VALUES ($1, $2, $3, now())`, [
    id,
    name,
    name.toLowerCase().replace(/\s+/g, "-"),
  ]);
  await q(`INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, $3, now())`, [
    userId,
    email,
    userName,
  ]);
  await q(
    `INSERT INTO members (user_id, organization_id, role, updated_at) VALUES ($1, $2, 'owner', now())`,
    [userId, id],
  );
}

async function account(
  id: string,
  tenantId: string,
  alias: string,
  number: string,
  currency: string,
  role: string,
  userId: string,
  fmt: string,
) {
  await q(
    `INSERT INTO bank_accounts (id, tenant_id, account_alias, account_number, currency, bank_format_id, role, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::bank_account_role, $8)`,
    [id, tenantId, alias, number, currency, fmt, role, userId],
  );
}

async function bankImport(id: string, tenantId: string, accountId: string, userId: string) {
  await q(
    `INSERT INTO bank_imports (id, tenant_id, bank_account_id, file_name, created_by, updated_at)
     VALUES ($1, $2, $3, 'rows.csv', $4, now())`,
    [id, tenantId, accountId, userId],
  );
}

async function rule(
  id: string,
  tenantId: string,
  name: string,
  pattern: string,
  bas: string,
  partnerId: string | null,
  userId: string,
) {
  await q(
    `INSERT INTO categorisation_rules (id, tenant_id, name, match_type, match_pattern, match_field, bas_code, partner_id,
       no_document_needed, created_by, updated_at)
     VALUES ($1, $2, $3, 'contains', $4, 'counterparty_key', $5, $6, true, $7, now())`,
    [id, tenantId, name, pattern, bas, partnerId, userId],
  );
}

async function row(
  id: string,
  tenantId: string,
  accountId: string,
  importId: string,
  key: string,
  amount: string,
  currency: string,
  bas: string,
  by: "manual" | "rule",
  ruleId: string | null,
  partnerId: string | null,
  userId: string,
  index: number,
) {
  await q(
    `INSERT INTO bank_transactions (id, tenant_id, bank_account_id, bank_import_id, booking_date, amount, currency,
       description, counterparty_key, dedup_hash, row_index, amount_base, rate, rate_source, bas_code,
       no_document_needed, categorised_by, rule_id, partner_id, created_by)
     VALUES ($1, $2, $3, $4, '2026-07-08', $5, $6, $7, $7, $14, $8, $5, 1,
       'same_currency', $9, true, $10::journal_categorised_by, $11, $12, $13)`,
    [
      id,
      tenantId,
      accountId,
      importId,
      amount,
      currency,
      key,
      index,
      bas,
      by,
      ruleId,
      partnerId,
      userId,
      id.slice(-1).repeat(64),
    ],
  );
}

/** US5's fixture: tenant A with a hand-made Skatteverket, Acme and Byteform AG; tenant B with no partner at all. */
async function fixture() {
  const fmt = (await q(`SELECT id FROM bank_formats ORDER BY created_at LIMIT 1`)).rows[0]
    ?.id as string;
  await tenant(T_A, "Fixture A AB", U_A, "Ada Owner", "ada@fixture-a.test");
  await tenant(T_B, "Fixture B AB", U_B, "Bo Owner", "bo@fixture-b.test");
  await account(ACC_A_SEK, T_A, "Plusgirokonto SEK", "123 45 67-8", "SEK", "main", U_A, fmt);
  await account(ACC_A_CHF, T_A, "Plusgirokonto CHF", "123 45 67-8", "CHF", "main", U_A, fmt);
  await account(ACC_A_SAV, T_A, "Sparkonto", "1234 56 78901", "SEK", "savings", U_A, fmt);
  await account(ACC_B_SEK, T_B, "Plusgirokonto SEK", "987 65 43-2", "SEK", "main", U_B, fmt);
  await bankImport(IMP_A_SEK, T_A, ACC_A_SEK, U_A);
  await bankImport(IMP_A_CHF, T_A, ACC_A_CHF, U_A);
  await bankImport(IMP_A_SAV, T_A, ACC_A_SAV, U_A);
  await bankImport(IMP_B_SEK, T_B, ACC_B_SEK, U_B);
  await q(
    `INSERT INTO partners (id, tenant_id, name, types, created_by, updated_at)
     VALUES ($1, $4, 'Skatteverket', ARRAY['vendor'], $5, now()),
            ($2, $4, 'Acme', ARRAY['client'], $5, now()),
            ($3, $4, 'Byteform AG', ARRAY['vendor'], $5, now())`,
    [P_SKV, P_ACME, P_BYTEFORM, T_A, U_A],
  );
  await rule(R_FEE_A, T_A, "Nordea bank fees", "AVGIFTER NORDEA", "657", null, U_A);
  await rule(R_INT_A, T_A, "Savings interest", "RÄNTA", "831", null, U_A);
  await rule(R_BYTE_A, T_A, "Byteform refunds", "BYTEFORM", "6540", P_BYTEFORM, U_A);
  await rule(R_FEE_B, T_B, "Nordea bank fees", "AVGIFTER NORDEA", "657", null, U_B);
  await row(
    ROW.R1,
    T_A,
    ACC_A_SEK,
    IMP_A_SEK,
    "AVGIFTER NORDEA",
    "-139.00",
    "SEK",
    "657",
    "rule",
    R_FEE_A,
    null,
    U_A,
    0,
  );
  await row(
    ROW.R2,
    T_A,
    ACC_A_SAV,
    IMP_A_SAV,
    "RÄNTA",
    "12.40",
    "SEK",
    "8310",
    "rule",
    R_INT_A,
    null,
    U_A,
    0,
  );
  await row(
    ROW.R3,
    T_A,
    ACC_A_SEK,
    IMP_A_SEK,
    "SKATTEVERKET",
    "-31400.00",
    "SEK",
    "251",
    "manual",
    null,
    null,
    U_A,
    1,
  );
  await row(
    ROW.R4,
    T_A,
    ACC_A_CHF,
    IMP_A_CHF,
    "ESTV MWST",
    "-2800.00",
    "CHF",
    "2510",
    "manual",
    null,
    null,
    U_A,
    0,
  );
  await row(
    ROW.R5,
    T_A,
    ACC_A_SEK,
    IMP_A_SEK,
    "LÖN",
    "-45000.00",
    "SEK",
    "7210",
    "manual",
    null,
    null,
    U_A,
    2,
  );
  await row(
    ROW.R6,
    T_A,
    ACC_A_SEK,
    IMP_A_SEK,
    "BYTEFORM AG",
    "250.00",
    "SEK",
    "6540",
    "rule",
    R_BYTE_A,
    null,
    U_A,
    3,
  );
  await row(
    ROW.R7,
    T_A,
    ACC_A_SEK,
    IMP_A_SEK,
    "MISC",
    "-99.00",
    "SEK",
    "6540",
    "manual",
    null,
    null,
    U_A,
    4,
  );
  await row(
    ROW.R8,
    T_A,
    ACC_A_SEK,
    IMP_A_SEK,
    "AVGIFTER NORDEA",
    "-139.00",
    "SEK",
    "657",
    "rule",
    R_FEE_A,
    P_ACME,
    U_A,
    5,
  );
  await row(
    ROW.R9,
    T_B,
    ACC_B_SEK,
    IMP_B_SEK,
    "AVGIFTER NORDEA",
    "-95.00",
    "SEK",
    "657",
    "rule",
    R_FEE_B,
    null,
    U_B,
    0,
  );
}

type Snapshot = {
  partners: number;
  audits: number;
  rows: { id: string; partner_id: string | null; categorised_by: string; rule_id: string | null }[];
  rules: { id: string; partner_id: string | null }[];
};

async function snapshot(): Promise<Snapshot> {
  return {
    partners: Number((await q(`SELECT count(*) FROM partners`)).rows[0]?.count),
    audits: Number((await q(`SELECT count(*) FROM audit_logs`)).rows[0]?.count),
    rows: (
      await q(
        `SELECT id, partner_id, categorised_by::text, rule_id FROM bank_transactions ORDER BY tenant_id, row_index, id`,
      )
    ).rows,
    rules: (await q(`SELECT id, partner_id FROM categorisation_rules ORDER BY id`)).rows,
  };
}

beforeAll(async () => {
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
});

afterAll(async () => {
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await admin.end();
});

describe("justified_partner (F129 US5)", () => {
  it("seeds the four partners per tenant, backfills the rows and the rules once, logs the counts, and a second run changes nothing", async () => {
    await freshSchema();
    await fixture();
    const before = await snapshot();
    notices.length = 0;

    const sql = migrationSql(MIGRATION);
    await db.query(sql);

    // 1. four partners per tenant: B's created; A's Skatteverket attached to the hand-made one, the other three created
    const roles = await q(
      `SELECT tenant_id, system_role, id, name, types, default_currency, source, is_active
         FROM partners WHERE system_role IS NOT NULL ORDER BY tenant_id, system_role`,
    );
    const byRole = (t: string) =>
      Object.fromEntries(
        roles.rows.filter((r) => r.tenant_id === t).map((r) => [r.system_role, r]),
      );
    const a = byRole(T_A);
    const b = byRole(T_B);
    expect(Object.keys(a).sort()).toEqual(["bank", "owner", "tax_agency_ch", "tax_agency_se"]);
    expect(Object.keys(b).sort()).toEqual(["bank", "owner", "tax_agency_ch", "tax_agency_se"]);
    expect(a.tax_agency_se).toMatchObject({ id: P_SKV, name: "Skatteverket", types: ["vendor"] });
    expect(a.bank).toMatchObject({ name: "Nordea", types: ["vendor"], source: "migration" });
    expect(a.tax_agency_ch).toMatchObject({
      name: "Swiss Federal Tax Administration (FTA)",
      types: ["authority"],
      default_currency: "CHF",
    });
    expect(a.owner).toMatchObject({ name: "Ada Owner", types: ["employee"], is_active: true });
    expect(b.tax_agency_se).toMatchObject({
      name: "Skatteverket",
      types: ["authority"],
      default_currency: "SEK",
    });
    expect(b.owner).toMatchObject({ name: "Bo Owner", types: ["employee"] });
    expect(b.bank.id).not.toBe(a.bank.id);
    expect(
      Number((await q(`SELECT count(*) FROM partners WHERE tenant_id = $1`, [T_A])).rows[0]?.count),
    ).toBe(6);
    expect(
      Number((await q(`SELECT count(*) FROM partners WHERE tenant_id = $1`, [T_B])).rows[0]?.count),
    ).toBe(4);

    // 2. the rows: 7 backfilled (1 by rule, 6 by account), 1 re-opened, 1 untouched — categorised_by and rule_id as before
    const after = await snapshot();
    const partnerOf = Object.fromEntries(after.rows.map((r) => [r.id, r.partner_id]));
    expect(partnerOf).toEqual({
      [ROW.R1]: a.bank.id,
      [ROW.R2]: a.bank.id,
      [ROW.R3]: P_SKV,
      [ROW.R4]: a.tax_agency_ch.id,
      [ROW.R5]: a.owner.id,
      [ROW.R6]: P_BYTEFORM,
      [ROW.R7]: null,
      [ROW.R8]: P_ACME,
      [ROW.R9]: b.bank.id,
    });
    expect(after.rows.map((r) => [r.id, r.categorised_by, r.rule_id])).toEqual(
      before.rows.map((r) => [r.id, r.categorised_by, r.rule_id]),
    );

    // 3. the rules: the three fee / interest rules → each tenant's bank; Byteform's keeps its own; none left for Needs a look
    const ruleOf = Object.fromEntries(after.rules.map((r) => [r.id, r.partner_id]));
    expect(ruleOf).toEqual({
      [R_FEE_A]: a.bank.id,
      [R_INT_A]: a.bank.id,
      [R_BYTE_A]: P_BYTEFORM,
      [R_FEE_B]: b.bank.id,
    });
    expect(
      Number(
        (
          await q(
            `SELECT count(*) FROM categorisation_rules WHERE is_active AND no_document_needed AND partner_id IS NULL`,
          )
        ).rows[0]?.count,
      ),
    ).toBe(0);

    // 4. the trail: one update row per backfilled row (the reversal path), the owner as its user; the partners' and
    //    the rules' own rows beside them
    const trail = await q(
      `SELECT entity_id, tenant_id, user_id, old_data, new_data, source FROM audit_logs
        WHERE entity_type = 'bank_transaction' AND action = 'update' AND new_data->>'migration' = 'justified_partner'
        ORDER BY entity_id`,
    );
    expect(trail.rows.map((r) => r.entity_id)).toEqual(
      [ROW.R1, ROW.R2, ROW.R3, ROW.R4, ROW.R5, ROW.R6, ROW.R9].sort(),
    );
    for (const r of trail.rows) {
      expect(r.source).toBe("migration");
      expect(r.old_data).toEqual({ partnerId: null });
      expect(r.new_data.partnerId).toBe(partnerOf[r.entity_id]);
      expect(r.user_id).toBe(r.tenant_id === T_A ? U_A : U_B);
    }
    expect(
      Number(
        (
          await q(
            `SELECT count(*) FROM audit_logs WHERE entity_type = 'partner' AND action = 'create' AND source = 'migration'`,
          )
        ).rows[0]?.count,
      ),
    ).toBe(7);
    expect(
      (
        await q(
          `SELECT entity_id, new_data FROM audit_logs WHERE entity_type = 'partner' AND action = 'update' AND source = 'migration'`,
        )
      ).rows,
    ).toEqual([
      {
        entity_id: P_SKV,
        new_data: { systemRole: "tax_agency_se", migration: "justified_partner" },
      },
    ]);
    expect(
      (
        await q(
          `SELECT entity_id FROM audit_logs WHERE entity_type = 'categorisation_rule' AND source = 'migration' ORDER BY entity_id`,
        )
      ).rows.map((r) => r.entity_id),
    ).toEqual([R_FEE_A, R_INT_A, R_FEE_B].sort());

    // 5. the log lines the box prints
    expect(notices).toContain(
      "justified_partner: 7 row(s) backfilled — 1 by their rule, 6 by their account; 1 row(s) re-open as *no proof · no partner* (0 more on a savings account need none)",
    );
    expect(notices).toContain(
      "justified_partner: 3 rule(s) given a partner; 0 active no-proof rule(s) left for *Needs a look*",
    );
    expect(notices).toContain(
      "justified_partner: 7 partner(s) created and 1 role(s) attached over 2 tenant(s); 0 tenant(s) without a member skipped",
    );

    // 6. the row that could not be placed is what the owner sees: *no proof · no partner*
    expect(
      deriveTransactionState({
        amount: "-99.00",
        allocated: "0.00",
        inTransfer: false,
        noDocumentNeeded: true,
        partnerId: null,
        accountRole: "main",
      }),
    ).toBe("no_document_no_partner");

    // 7. a second run of the data part (the DDL is Prisma's, once): every role held, nothing to place — zeros
    notices.length = 0;
    const dataPart = sql.slice(sql.indexOf("CREATE TEMP TABLE jp_owner"));
    await db.query(dataPart);
    const again = await snapshot();
    expect(again).toEqual(after);
    expect(notices).toContain(
      "justified_partner: 0 partner(s) created and 0 role(s) attached over 2 tenant(s); 0 tenant(s) without a member skipped",
    );
    expect(notices).toContain(
      "justified_partner: 0 row(s) backfilled — 0 by their rule, 0 by their account; 1 row(s) re-open as *no proof · no partner* (0 more on a savings account need none)",
    );

    // the partial unique index: a second partner cannot take a role
    await expect(
      q(`UPDATE partners SET system_role = 'bank' WHERE id = $1`, [P_ACME]),
    ).rejects.toThrow(/partners_tenant_system_role_key/);
    await expect(
      q(`UPDATE partners SET system_role = 'cfo' WHERE id = $1`, [P_ACME]),
    ).rejects.toThrow(/partners_system_role_check/);
  });
});
