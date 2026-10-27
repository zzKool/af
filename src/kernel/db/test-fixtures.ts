import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { roleFromMembership } from "@/kernel/auth/can";

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
    role: roleFromMembership(role),
    source: "web" as const,
  });

  return { headers, callerIdentity };
}

/**
 * Creates a test partner directly via SQL with tenant context set (RLS-aware).
 */
export async function createTestPartner(
  pool: Pool,
  tenantId: string,
  createdBy: string,
  overrides?: {
    name?: string;
    types?: string[];
    orgNumber?: string;
    defaultCurrency?: string;
    defaultBasCategoryCode?: string;
    isActive?: boolean;
  },
): Promise<{ id: string; name: string; types: string[] }> {
  const partner = {
    id: randomUUID(),
    name: overrides?.name ?? `Partner ${randomUUID().slice(0, 8)}`,
    types: overrides?.types ?? ["client"],
    orgNumber: overrides?.orgNumber ?? null,
    defaultCurrency: overrides?.defaultCurrency ?? null,
    defaultBasCategoryCode: overrides?.defaultBasCategoryCode ?? null,
    isActive: overrides?.isActive ?? true,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!UUID_RE.test(tenantId)) {
      throw new Error(`Invalid tenant ID format: ${tenantId}`);
    }
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await client.query(
      `INSERT INTO partners (id, tenant_id, name, types, org_number, default_currency, default_bas_category_code, is_active, created_by, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'web', NOW())`,
      [
        partner.id,
        tenantId,
        partner.name,
        partner.types,
        partner.orgNumber,
        partner.defaultCurrency,
        partner.defaultBasCategoryCode,
        partner.isActive,
        createdBy,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return partner;
}

/**
 * Creates a test contract directly via SQL with tenant context set (RLS-aware).
 */
export async function createTestContract(
  pool: Pool,
  tenantId: string,
  createdBy: string,
  partnerId: string,
  overrides?: {
    name?: string;
    startDate?: string;
    endDate?: string;
    assignedEmployeeId?: string;
    currency?: string;
    paymentTerms?: string;
    vatRegistrationId?: string;
    isActive?: boolean;
  },
): Promise<{ id: string; name: string }> {
  const contract = {
    id: randomUUID(),
    name: overrides?.name ?? `Contract ${randomUUID().slice(0, 8)}`,
    startDate: overrides?.startDate ?? "2026-01-01",
    endDate: overrides?.endDate ?? null,
    assignedEmployeeId: overrides?.assignedEmployeeId ?? null,
    currency: overrides?.currency ?? null,
    paymentTerms: overrides?.paymentTerms ?? null,
    vatRegistrationId: overrides?.vatRegistrationId ?? null,
    isActive: overrides?.isActive ?? true,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!UUID_RE.test(tenantId)) {
      throw new Error(`Invalid tenant ID format: ${tenantId}`);
    }
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await client.query(
      `INSERT INTO contracts (id, tenant_id, name, partner_id, start_date, end_date, assigned_employee_id, currency, payment_terms, vat_registration_id, is_active, created_by, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'web', NOW())`,
      [
        contract.id,
        tenantId,
        contract.name,
        partnerId,
        contract.startDate,
        contract.endDate,
        contract.assignedEmployeeId,
        contract.currency,
        contract.paymentTerms,
        contract.vatRegistrationId,
        contract.isActive,
        createdBy,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return contract;
}

/**
 * Creates a test document directly via SQL with tenant context set (RLS-aware).
 */
export async function createTestDocument(
  pool: Pool,
  tenantId: string,
  createdBy: string,
  overrides?: {
    businessKey?: string;
    fileName?: string;
    blobUrl?: string;
    mimeType?: string;
    fileSize?: number;
    prefixType?: string;
    documentType?: string;
    status?: string;
    /** the sha256 of the bytes — two fixtures with the same hash are "the same file twice" */
    contentHash?: string;
  },
): Promise<{ id: string; businessKey: string; fileName: string }> {
  const doc = {
    id: randomUUID(),
    businessKey:
      overrides?.businessKey ??
      `exp_20260314_${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`,
    fileName: overrides?.fileName ?? `test-doc-${randomUUID().slice(0, 8)}.pdf`,
    blobUrl: overrides?.blobUrl ?? `${tenantId}/${randomUUID()}.pdf`,
    mimeType: overrides?.mimeType ?? "application/pdf",
    fileSize: overrides?.fileSize ?? 1024,
    prefixType: overrides?.prefixType ?? "expense",
    documentType: overrides?.documentType ?? "financial",
    status: overrides?.status ?? "uploaded",
    contentHash: overrides?.contentHash ?? null,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!UUID_RE.test(tenantId)) {
      throw new Error(`Invalid tenant ID format: ${tenantId}`);
    }
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await client.query(
      `INSERT INTO documents (id, tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type, document_type, status, created_by, source, updated_at, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'web', NOW(), $12)`,
      [
        doc.id,
        tenantId,
        doc.businessKey,
        doc.fileName,
        doc.blobUrl,
        doc.mimeType,
        doc.fileSize,
        doc.prefixType,
        doc.documentType,
        doc.status,
        createdBy,
        doc.contentHash,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return doc;
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
    // documents BEFORE partners, contracts BEFORE partners (FK dependency)
    await client.query(
      "TRUNCATE number_series, links, ecb_rates, audit_logs, subscription_pauses, subscription_prices, subscriptions, supplier_invoice_lines, supplier_invoices, trips, normalbelopp, settlements, expenses, expense_groups, journal_entries, bank_transactions, bank_imports, categorisation_rules, bank_accounts, documents, invoice_lines, invoices, contract_rates, contracts, partner_contacts, partners, tenant_configs, tenants, invitations, members, accounts, verifications, sessions, users, organizations CASCADE",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
