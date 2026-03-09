import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

interface TestTenantData {
  id: string;
  name: string;
}

interface TestUserData {
  id: string;
  email: string;
  name: string;
}

/**
 * Creates a test tenant directly via SQL (bypasses RLS using a fresh connection).
 * Used in test setup to create tenants before RLS-scoped operations.
 */
export async function createTestTenant(
  pool: Pool,
  overrides?: Partial<TestTenantData>,
): Promise<TestTenantData> {
  const tenant = {
    id: overrides?.id ?? randomUUID(),
    name: overrides?.name ?? `Test Tenant ${randomUUID().slice(0, 8)}`,
  };

  await pool.query(`INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())`, [
    tenant.id,
    tenant.name,
  ]);

  return tenant;
}

/**
 * Creates a test user directly via SQL.
 */
export async function createTestUser(
  pool: Pool,
  overrides?: Partial<TestUserData>,
): Promise<TestUserData> {
  const user = {
    id: overrides?.id ?? randomUUID(),
    email: overrides?.email ?? `test-${randomUUID().slice(0, 8)}@test.local`,
    name: overrides?.name ?? "Test User",
  };

  await pool.query(`INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, $3, NOW())`, [
    user.id,
    user.email,
    user.name,
  ]);

  return user;
}

/**
 * Creates a tenant config entry via SQL with tenant context set.
 * This uses SET LOCAL within a transaction to respect RLS.
 */
export async function createTestTenantConfig(
  pool: Pool,
  tenantId: string,
  createdBy: string,
  overrides?: { key?: string; value?: string; source?: string },
): Promise<{ id: string; key: string; value: string }> {
  const config = {
    id: randomUUID(),
    key: overrides?.key ?? `config-${randomUUID().slice(0, 8)}`,
    value: overrides?.value ?? "test-value",
    source: overrides?.source ?? "system",
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await client.query(
      `INSERT INTO tenant_configs (id, tenant_id, key, value, created_by, source, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [config.id, tenantId, config.key, config.value, createdBy, config.source],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return config;
}

/**
 * Cleans up all test data. Used in afterEach or afterAll hooks.
 */
export async function cleanupTestData(pool: Pool): Promise<void> {
  // Disable RLS temporarily for cleanup (use superuser-level access)
  // Since the test DB user owns the tables, we need to bypass RLS
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Set a dummy tenant_id so RLS doesn't block — but FORCE RLS means we
    // need to truncate using TRUNCATE which bypasses RLS
    await client.query(
      "TRUNCATE tenant_configs, tenants, members, accounts, sessions, users CASCADE",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
