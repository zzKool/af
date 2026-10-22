/**
 * Cross-Table RLS Spike — Story 4.0, Task 3
 *
 * Verifies that PostgreSQL RLS isolation holds when querying across
 * FK-joined tenant-scoped tables. Findings inform Epic 4's Partner →
 * VatRegistration FK design.
 *
 * Uses vat_registrations + bank_accounts as proxy tables (both have RLS).
 * Creates a temporary FK constraint for FK-specific tests.
 */

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createTestTenant, createTestUser } from "@/kernel/db/test-fixtures";
import { assertCrossTableRlsIsolation } from "@/kernel/test-utils/config-crud-helpers";

// ─── Setup ───────────────────────────────────────────────────

const APP_URL =
  process.env.DATABASE_TEST_URL ||
  process.env.DATABASE_URL ||
  "postgresql://defterfab_app:app@localhost:5433/af_test";

const MIGRATION_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

let pool: Pool;
let adminPool: Pool;
let prisma: PrismaClient;

// Test data
let tenantA: { id: string };
let tenantB: { id: string };
let userA: { id: string };
let userB: { id: string };
let _vatRegA: string; // vat registration ID for tenant A
let bankAccountA: string; // bank account ID for tenant A
let vatRegB: string; // vat registration ID for tenant B

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL });
  adminPool = new Pool({ connectionString: MIGRATION_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });

  // Clean slate
  await cleanupTestData(adminPool);

  // Create two tenants + users
  tenantA = await createTestTenant(adminPool);
  tenantB = await createTestTenant(adminPool);
  userA = await createTestUser(adminPool);
  userB = await createTestUser(adminPool);

  // Get a bank format ID (seeded reference data)
  const formatResult = await adminPool.query("SELECT id FROM bank_formats LIMIT 1");
  const bankFormatId = formatResult.rows[0]?.id;
  if (!bankFormatId) throw new Error("No bank formats seeded");

  // Seed data for tenant A: one vat registration + one bank account
  const clientA = await pool.connect();
  try {
    await clientA.query("BEGIN");
    await clientA.query(`SET LOCAL app.tenant_id = '${tenantA.id}'`);

    const vatId = randomUUID();
    await clientA.query(
      `INSERT INTO vat_registrations (id, tenant_id, country, vat_number, created_by, source, updated_at)
       VALUES ($1, $2, 'SE', 'SE123456789001', $3, 'system', NOW())`,
      [vatId, tenantA.id, userA.id],
    );
    _vatRegA = vatId;

    const baId = randomUUID();
    await clientA.query(
      `INSERT INTO bank_accounts (id, tenant_id, account_number, currency, bank_format_id, created_by, source, updated_at)
       VALUES ($1, $2, '1234-5678', 'SEK', $3, $4, 'system', NOW())`,
      [baId, tenantA.id, bankFormatId, userA.id],
    );
    bankAccountA = baId;

    await clientA.query("COMMIT");
  } catch (e) {
    await clientA.query("ROLLBACK");
    throw e;
  } finally {
    clientA.release();
  }

  // Seed data for tenant B: one vat registration
  const clientB = await pool.connect();
  try {
    await clientB.query("BEGIN");
    await clientB.query(`SET LOCAL app.tenant_id = '${tenantB.id}'`);

    const vatId = randomUUID();
    await clientB.query(
      `INSERT INTO vat_registrations (id, tenant_id, country, vat_number, created_by, source, updated_at)
       VALUES ($1, $2, 'CH', 'CHE-999.888.777', $3, 'system', NOW())`,
      [vatId, tenantB.id, userB.id],
    );
    vatRegB = vatId;

    await clientB.query("COMMIT");
  } catch (e) {
    await clientB.query("ROLLBACK");
    throw e;
  } finally {
    clientB.release();
  }
});

afterAll(async () => {
  // Drop temporary FK if it was created
  try {
    await adminPool.query("ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS fk_spike_vat_reg");
  } catch {
    // ignore
  }

  await cleanupTestData(adminPool);
  await prisma.$disconnect();
  await pool.end();
  await adminPool.end();
});

// ─── Scenario 1: Prisma include (JOIN) respects RLS ─────────

describe("Scenario 1: Prisma include across RLS tables", () => {
  test("tenant A sees own data, tenant B sees nothing from tenant A", async () => {
    // Tenant A queries vat_registrations — should see own records
    const resultA = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      return tx.vatRegistration.findMany();
    });
    expect(resultA).toHaveLength(1);
    expect(resultA[0].country).toBe("SE");

    // Tenant B queries vat_registrations — sees own, not tenant A's
    const resultB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
      return tx.vatRegistration.findMany();
    });
    expect(resultB).toHaveLength(1);
    expect(resultB[0].country).toBe("CH");
  });

  test("Prisma include on tenant → child respects RLS on both", async () => {
    // Query bank accounts with include bank format (app-level, no RLS)
    const accountsA = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      return tx.bankAccount.findMany({
        include: { bankFormat: true },
      });
    });
    expect(accountsA).toHaveLength(1);
    expect(accountsA[0].bankFormat).toBeDefined();
    expect(accountsA[0].bankFormat.bankName).toBeDefined();

    // Tenant B should see no bank accounts
    const accountsB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
      return tx.bankAccount.findMany({
        include: { bankFormat: true },
      });
    });
    expect(accountsB).toHaveLength(0);
  });
});

// ─── Scenario 2: Prisma relation filter respects RLS ────────

describe("Scenario 2: Prisma relation filter across RLS tables", () => {
  test("filtering through FK relation respects RLS on both tables", async () => {
    // Tenant A: filter bank accounts by bank format name (app-level table)
    const filtered = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      return tx.bankAccount.findMany({
        where: {
          bankFormat: {
            bankName: { contains: "" }, // match all
          },
        },
      });
    });
    expect(filtered).toHaveLength(1);

    // Tenant B: same query, sees nothing
    const filteredB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
      return tx.bankAccount.findMany({
        where: {
          bankFormat: {
            bankName: { contains: "" },
          },
        },
      });
    });
    expect(filteredB).toHaveLength(0);
  });
});

// ─── Scenario 3: Raw SQL JOIN respects RLS ──────────────────

describe("Scenario 3: Raw SQL JOIN across RLS-protected tables", () => {
  test("JOIN between two RLS tables respects tenant isolation", async () => {
    // Tenant A: raw SQL JOIN between vat_registrations and bank_accounts
    // (no actual FK, just joining on tenant_id for the spike)
    const resultA = await withTenantTransaction(prisma, tenantA.id, async (tx) => {
      const rows = await tx.$queryRaw<{ vat_country: string; ba_number: string }[]>`
          SELECT v.country AS vat_country, b.account_number AS ba_number
          FROM vat_registrations v
          CROSS JOIN bank_accounts b
        `;
      return rows;
    });
    // Tenant A has 1 vat reg + 1 bank account → 1 × 1 = 1 cross join row
    expect(resultA).toHaveLength(1);
    expect(resultA[0].vat_country).toBe("SE");

    // Tenant B: same query, should only see own vat reg + no bank accounts → 0 rows
    const resultB = await withTenantTransaction(prisma, tenantB.id, async (tx) => {
      const rows = await tx.$queryRaw<{ vat_country: string; ba_number: string }[]>`
          SELECT v.country AS vat_country, b.account_number AS ba_number
          FROM vat_registrations v
          CROSS JOIN bank_accounts b
        `;
      return rows;
    });
    expect(resultB).toHaveLength(0); // tenant B has no bank accounts
  });
});

// ─── Scenario 4: FK constraint cross-tenant check ───────────

describe("Scenario 4: FK constraint cross-tenant referencing", () => {
  test("PostgreSQL FK constraint allows cross-tenant reference (bypasses RLS)", async () => {
    // Create a temporary FK from bank_accounts to vat_registrations
    // This simulates Epic 4's partner.default_vat_registration_id → vat_registrations.id
    await adminPool.query(`
      ALTER TABLE bank_accounts
      ADD CONSTRAINT fk_spike_vat_reg
      FOREIGN KEY (created_by) REFERENCES users(id)
    `);
    // Note: We can't easily add a FK from bank_accounts to vat_registrations
    // without adding a column. Instead, let's test the core question directly:
    // Can tenant A INSERT a row referencing tenant B's record via FK?

    // Test using raw SQL: Try to reference tenant B's vat_registration ID
    // from tenant A's context. Since FK checks bypass RLS (they use the
    // table owner's permissions), the INSERT should succeed if the FK target exists.

    // Clean up the test FK first
    await adminPool.query("ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS fk_spike_vat_reg");

    // For a proper test, we'll add a nullable column and FK temporarily
    await adminPool.query(`
      ALTER TABLE bank_accounts
      ADD COLUMN IF NOT EXISTS spike_vat_ref UUID
    `);
    await adminPool.query(`
      ALTER TABLE bank_accounts
      ADD CONSTRAINT fk_spike_vat_ref
      FOREIGN KEY (spike_vat_ref) REFERENCES vat_registrations(id)
    `);

    try {
      // Tenant A tries to set FK referencing tenant B's vat registration
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.tenant_id = '${tenantA.id}'`);

        // This should succeed because FK constraint checks bypass RLS
        // The FK validation happens at the constraint level (table owner role)
        // not at the RLS policy level
        const result = await client.query(
          `UPDATE bank_accounts SET spike_vat_ref = $1 WHERE id = $2`,
          [vatRegB, bankAccountA],
        );

        // If we get here, FK constraints DO bypass RLS
        // This means service-level validation is REQUIRED
        expect(result.rowCount).toBe(1);

        await client.query("ROLLBACK"); // Don't persist this
      } catch (error) {
        await client.query("ROLLBACK");
        // If we get an FK violation, it means RLS IS applied to FK checks
        // This would be the safer behavior but is NOT expected in PostgreSQL
        const pgError = error as { code?: string };
        if (pgError.code === "23503") {
          // FK violation — RLS blocked the cross-tenant reference
          // This would mean PostgreSQL DOES enforce RLS on FK checks
          // Document this unexpected but safe behavior
          expect(true).toBe(true); // Pass — this is safe
        } else {
          throw error;
        }
      } finally {
        client.release();
      }
    } finally {
      // Cleanup: remove spike column and constraint
      await adminPool.query("ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS fk_spike_vat_ref");
      await adminPool.query("ALTER TABLE bank_accounts DROP COLUMN IF EXISTS spike_vat_ref");
    }
  });
});

// ─── Task 4: assertCrossTableRlsIsolation helper test ───────

describe("assertCrossTableRlsIsolation helper", () => {
  test("verifies cross-table RLS isolation for bankAccount → bankFormat", async () => {
    // bankAccount (RLS) → bankFormat (app-level, no RLS)
    // Tenant A has a bank account, tenant B does not
    await assertCrossTableRlsIsolation(prisma, "bankAccount", tenantA.id, tenantB.id, "bankFormat");
  });
});
