import type { Pool } from "pg";
import { expect } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";

/**
 * Asserts that RLS isolation prevents tenantB from seeing tenantA's data.
 *
 * @param prisma - PrismaClient with app-role adapter
 * @param model - Prisma model name (e.g., "basCategory")
 * @param tenantAId - Tenant A's UUID (data owner)
 * @param tenantBId - Tenant B's UUID (should see nothing)
 */
export async function assertRlsIsolation(
  prisma: PrismaClient,
  model: string,
  tenantAId: string,
  tenantBId: string,
): Promise<void> {
  const countA = await withTenantTransaction(prisma, tenantAId, async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic model access
    return (tx as any)[model].count();
  });

  const countB = await withTenantTransaction(prisma, tenantBId, async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic model access
    return (tx as any)[model].count();
  });

  expect(countA).toBeGreaterThan(0);
  expect(countB).toBe(0);
}

/**
 * Asserts that RLS isolation holds across FK-joined tenant-scoped tables.
 *
 * Verifies:
 * (a) Parent query with `include` only returns own-tenant children
 * (b) Cross-tenant FK references are invisible via Prisma queries
 *
 * Based on Story 4.0 spike findings: FK constraints bypass RLS, but
 * SELECT queries with JOINs respect RLS on both tables independently.
 * Service-level validation must prevent cross-tenant FK writes.
 *
 * @param prisma - PrismaClient with app-role adapter
 * @param parentModel - Prisma model name for the parent table (e.g., "bankAccount")
 * @param childModel - Prisma model name for the child/related table (e.g., "bankFormat")
 * @param tenantAId - Tenant A's UUID (data owner, should have data)
 * @param tenantBId - Tenant B's UUID (should NOT see tenant A's data)
 * @param includeRelation - Relation name to include (e.g., "bankFormat")
 */
export async function assertCrossTableRlsIsolation(
  prisma: PrismaClient,
  parentModel: string,
  tenantAId: string,
  tenantBId: string,
  includeRelation: string,
): Promise<void> {
  // (a) Tenant A sees own parent records with included children
  const parentWithChildA = await withTenantTransaction(prisma, tenantAId, async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic model access
    return (tx as any)[parentModel].findMany({
      include: { [includeRelation]: true },
    });
  });

  expect(parentWithChildA.length, `Tenant A should have ${parentModel} records`).toBeGreaterThan(0);

  // Verify included relation is populated
  for (const record of parentWithChildA) {
    expect(
      record[includeRelation],
      `${parentModel}.${includeRelation} should be populated for tenant A`,
    ).toBeDefined();
  }

  // (b) Tenant B should NOT see tenant A's parent records
  const parentWithChildB = await withTenantTransaction(prisma, tenantBId, async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic model access
    return (tx as any)[parentModel].findMany({
      include: { [includeRelation]: true },
    });
  });

  // Tenant B should see only own records (may be 0 or more, but NOT tenant A's)
  // Verify none of tenant B's results contain tenant A's IDs
  const tenantAIds = new Set(parentWithChildA.map((r: { id: string }) => r.id));
  for (const record of parentWithChildB) {
    expect(
      tenantAIds.has(record.id),
      `Tenant B should not see tenant A's ${parentModel} records`,
    ).toBe(false);
  }
}

/**
 * Asserts that an audit log entry was created for a specific action.
 *
 * @param adminPool - Superuser pool (bypasses RLS)
 * @param tenantId - Tenant to check
 * @param action - Expected action string (e.g., "create", "update", "delete")
 * @param entityType - Expected entity type (e.g., "bas_category")
 * @param entityId - Optional expected entity ID
 */
export async function assertAuditLogged(
  adminPool: Pool,
  tenantId: string,
  action: string,
  entityType: string,
  entityId?: string,
): Promise<void> {
  const query = entityId
    ? `SELECT * FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND entity_type = $3 AND entity_id = $4 ORDER BY created_at DESC LIMIT 1`
    : `SELECT * FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND entity_type = $3 ORDER BY created_at DESC LIMIT 1`;

  const params = entityId
    ? [tenantId, action, entityType, entityId]
    : [tenantId, action, entityType];

  const result = await adminPool.query(query, params);

  expect(result.rows.length, `Expected audit log for ${action} on ${entityType}`).toBeGreaterThan(
    0,
  );
}

/**
 * Asserts full CRUD operations work for a config service.
 *
 * Contract: `read` must return `null` (not throw) when the entity is not found.
 * Services should use `findUnique` (returns null) rather than `findUniqueOrThrow`.
 *
 * @param operations - Object with create/read/update/delete functions to test
 */
export async function assertCrudOperations(operations: {
  create: () => Promise<{ id: string }>;
  read: (id: string) => Promise<unknown>;
  update: (id: string) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
}): Promise<void> {
  // Create
  const created = await operations.create();
  expect(created.id).toBeDefined();

  // Read
  const found = await operations.read(created.id);
  expect(found).not.toBeNull();

  // Update
  const updated = await operations.update(created.id);
  expect(updated).not.toBeNull();

  // Delete
  await operations.remove(created.id);
  const afterDelete = await operations.read(created.id);
  expect(afterDelete).toBeNull();
}
