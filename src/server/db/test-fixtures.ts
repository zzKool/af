import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { CallerIdentity } from "@/types/caller-identity";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (!UUID_RE.test(tenantId)) {
      throw new Error(`Invalid tenant ID format: ${tenantId}`);
    }
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
 * Creates an authenticated context via Better Auth API.
 * Signs up a user, creates an org, sets it active, and returns session headers
 * plus a frozen CallerIdentity. Reusable by all future story tests.
 */
type AuthApi = {
  // biome-ignore lint/suspicious/noExplicitAny: generic auth API signature requires flexible typing
  api: Record<string, (...args: any[]) => Promise<any>>;
};

export async function createAuthenticatedContext(
  authInstance: AuthApi,
  role: "owner" | "member",
  ownerContext?: { headers: Headers; orgId: string },
): Promise<{ headers: Headers; callerIdentity: CallerIdentity }> {
  const suffix = randomUUID().slice(0, 8);
  const email = `${role}-${suffix}@test.local`;

  const signUp = await authInstance.api.signUpEmail({
    body: { email, password: "password123", name: `Test ${role}` },
  });

  const response = await authInstance.api.signInEmail({
    body: { email, password: "password123" },
    asResponse: true,
  });
  const cookies = response.headers.getSetCookie();
  const headers = new Headers();
  headers.set("cookie", cookies.map((c: string) => c.split(";")[0]).join("; "));

  let orgId: string;
  if (role === "owner") {
    const org = await authInstance.api.createOrganization({
      headers,
      body: { name: `Org ${suffix}`, slug: `org-${suffix}` },
    });
    orgId = org.id;
  } else {
    if (!ownerContext) throw new Error("ownerContext required for member role");
    orgId = ownerContext.orgId;
    const invitation = await authInstance.api.createInvitation({
      headers: ownerContext.headers,
      body: { email, role: "member", organizationId: orgId },
    });
    await authInstance.api.acceptInvitation({
      headers,
      body: { invitationId: invitation.id },
    });
  }

  await authInstance.api.setActiveOrganization({
    headers,
    body: { organizationId: orgId },
  });

  const callerIdentity: CallerIdentity = Object.freeze({
    userId: signUp.user.id,
    tenantId: orgId,
    role: role === "owner" ? "owner" : "accountant",
    source: "web" as const,
  });

  return { headers, callerIdentity };
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
      "TRUNCATE ecb_rates, audit_logs, tenant_configs, tenants, invitations, members, accounts, verifications, sessions, users, organizations CASCADE",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
