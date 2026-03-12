import type { Pool } from "pg";
import { expect } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/server/db/tenant-client";

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
 * @param operations - Object with create/read/update/delete functions to test
 * @param fixtures - Test data for each operation
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
