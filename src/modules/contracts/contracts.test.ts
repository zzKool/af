import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestContract,
  createTestPartner,
} from "@/kernel/db/test-fixtures";
import { assertAuditLogged, assertRlsIsolation } from "@/kernel/test-utils/config-crud-helpers";
import * as contractService from "@/modules/contracts/contracts";
import * as partnerService from "@/modules/partners";

/** No-op audit logger for tests that don't care about audit */
const noopAudit: AuditLogger = { log: async () => {} };

/** Creates a real audit logger that writes to the DB */
function createRealAuditLogger(
  tx: import("@/kernel/db/tenant-client").TransactionClient,
  caller: CallerIdentity,
): AuditLogger {
  return {
    log: async (params) => {
      await createAuditEntry(tx, caller, params);
    },
  };
}

// Mock next/headers
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
});

afterAll(async () => {
  await adminPool.end();
});

/** Helper: create a client partner and return its id */
async function createClientPartner(
  tenantId: string,
  caller: CallerIdentity,
  overrides?: { name?: string; defaultCurrency?: "SEK" | "CHF" | "EUR" | "USD" },
): Promise<string> {
  const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
    return partnerService.createPartner(tx, caller, noopAudit, {
      name: overrides?.name ?? "Test Client",
      types: ["client"],
      defaultCurrency: overrides?.defaultCurrency,
    });
  });
  return result.data!.id;
}

/** Helper: create an employee partner and return its id */
async function createEmployeePartner(
  tenantId: string,
  caller: CallerIdentity,
  name?: string,
): Promise<string> {
  const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
    return partnerService.createPartner(tx, caller, noopAudit, {
      name: name ?? "Test Employee",
      types: ["employee"],
    });
  });
  return result.data!.id;
}

// ─────────────────────────────────────────────────────────────
// Contract service CRUD tests
// ─────────────────────────────────────────────────────────────
describe("contract service", () => {
  it("create: contract with all fields", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity, {
      defaultCurrency: "SEK",
    });
    const employeeId = await createEmployeePartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return contractService.createContract(tx, owner.callerIdentity, audit, {
        partnerId: clientId,
        name: "Consulting Agreement",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        assignedEmployeeId: employeeId,
        currency: "SEK",
        paymentTerms: "NET_30",
        externalReferences: [{ label: "Purchase Order", value: "PO-2026-1138" }],
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();

    // Verify stored
    const contracts = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContracts(tx, clientId);
    });
    expect(contracts.data?.length).toBe(1);
    expect(contracts.data?.[0].name).toBe("Consulting Agreement");
    expect(contracts.data?.[0].currency).toBe("SEK");
    expect(contracts.data?.[0].paymentTerms).toBe("NET_30");
  });

  it("create: contract with minimum fields (name + startDate)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Minimal Contract",
        startDate: "2026-03-01",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();

    const fetched = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContract(tx, result.data!.id);
    });
    expect(fetched.data?.name).toBe("Minimal Contract");
    expect(fetched.data?.endDate).toBeNull();
    expect(fetched.data?.currentRate).toBeNull();
    expect(fetched.data?.isActive).toBe(true);
  });

  it("update: change contract name", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Old Name",
        startDate: "2026-01-01",
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return contractService.updateContract(tx, owner.callerIdentity, audit, id, {
        name: "New Name",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);

    const fetched = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContract(tx, id);
    });
    expect(fetched.data?.name).toBe("New Name");
  });

  it("list: filters by partnerId and returns ordered by startDate DESC", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      await contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Older Contract",
        startDate: "2025-01-01",
      });
      await contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Newer Contract",
        startDate: "2026-06-01",
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContracts(tx, clientId);
    });

    expect(result.data?.length).toBe(2);
    expect(result.data?.[0].name).toBe("Newer Contract"); // DESC order
    expect(result.data?.[1].name).toBe("Older Contract");
  });

  it("list: filters out inactive by default", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "To Deactivate",
        startDate: "2026-01-01",
      });
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.deactivateContract(
        tx,
        owner.callerIdentity,
        noopAudit,
        created.data!.id,
      );
    });

    const defaultList = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContracts(tx, clientId);
    });
    expect(defaultList.data?.length).toBe(0);

    const fullList = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContracts(tx, clientId, { includeInactive: true });
    });
    expect(fullList.data?.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Validation tests
// ─────────────────────────────────────────────────────────────
describe("contract validation", () => {
  it("client-only partner check → VALIDATION_ERROR for non-client partner", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Create a vendor-only partner
    const vendorResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Vendor Only",
        types: ["vendor"],
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: vendorResult.data!.id,
        name: "Should Fail",
        startDate: "2026-01-01",
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("client type");
  });

  it("employee-type check → VALIDATION_ERROR for non-employee assigned partner", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    // Create a vendor (not employee) partner
    const vendorResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Not Employee",
        types: ["vendor"],
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Bad Employee Assignment",
        startDate: "2026-01-01",
        assignedEmployeeId: vendorResult.data!.id,
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("employee type");
  });

  it("VAT registration FK → NOT_FOUND for invalid ID", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Bad VAT",
        startDate: "2026-01-01",
        vatRegistrationId: "00000000-0000-0000-0000-000000000099",
      });
    });

    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toContain("VAT registration");
  });

  // Date edge cases
  it("date: no end date (indefinite engagement) → success", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Indefinite",
        startDate: "2026-01-01",
      });
    });
    expect(result.error).toBeUndefined();
  });

  it("date: end date in the past → success", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Expired",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      });
    });
    expect(result.error).toBeUndefined();
  });

  it("date: start date in the future → success", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Future",
        startDate: "2027-01-01",
        endDate: "2027-12-31",
      });
    });
    expect(result.error).toBeUndefined();
  });

  it("date: start date = end date (single-day engagement) → success", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Single Day",
        startDate: "2026-06-15",
        endDate: "2026-06-15",
      });
    });
    expect(result.error).toBeUndefined();
  });

  it("date: end date before start date → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Bad Dates",
        startDate: "2026-12-31",
        endDate: "2026-01-01",
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("End date");
  });

  it("no rate at creation → currentRate null (rates live in the history, D24)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "No Rate",
        startDate: "2026-01-01",
      });
    });

    expect(result.error).toBeUndefined();
    const fetched = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContract(tx, result.data!.id);
    });
    expect(fetched.data?.currentRate).toBeNull();
  });

  it("inactive partner creation guard → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    // Deactivate the partner
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.deactivatePartner(tx, owner.callerIdentity, noopAudit, clientId);
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Should Fail",
        startDate: "2026-01-01",
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("inactive");
  });

  it("update on inactive partner → success (only creation is blocked)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    // Create contract while partner is active
    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Existing Contract",
        startDate: "2026-01-01",
      });
    });

    // Deactivate the partner
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.deactivatePartner(tx, owner.callerIdentity, noopAudit, clientId);
    });

    // Update existing contract should succeed
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.updateContract(tx, owner.callerIdentity, noopAudit, created.data!.id, {
        name: "Updated After Partner Deactivation",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);
  });

  it("external references: invalid shape → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Bad Refs",
        startDate: "2026-01-01",
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        externalReferences: [{ label: "", value: "" }] as any,
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────
// Soft-delete lifecycle tests
// ─────────────────────────────────────────────────────────────
describe("contract soft-delete lifecycle", () => {
  it("create → deactivate → verify → reactivate → verify", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    // Create
    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Lifecycle Contract",
        startDate: "2026-01-01",
      });
    });
    const id = created.data!.id;

    // Deactivate
    const deactResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.deactivateContract(tx, owner.callerIdentity, noopAudit, id);
    });
    expect(deactResult.data?.deactivated).toBe(true);

    // Verify excluded from default list
    const defaultList = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContracts(tx, clientId);
    });
    expect(defaultList.data?.find((c) => c.id === id)).toBeUndefined();

    // Still readable by getContract
    const detail = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContract(tx, id);
    });
    expect(detail.data?.isActive).toBe(false);

    // Reactivate
    const reactResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.reactivateContract(tx, owner.callerIdentity, noopAudit, id);
    });
    expect(reactResult.data?.reactivated).toBe(true);

    // Visible again
    const afterReactivate = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContracts(tx, clientId);
    });
    expect(afterReactivate.data?.find((c) => c.id === id)?.isActive).toBe(true);
  });

  it("deactivate already inactive → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Test",
        startDate: "2026-01-01",
      });
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.deactivateContract(
        tx,
        owner.callerIdentity,
        noopAudit,
        created.data!.id,
      );
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.deactivateContract(
        tx,
        owner.callerIdentity,
        noopAudit,
        created.data!.id,
      );
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("already inactive");
  });

  it("reactivate already active → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Test",
        startDate: "2026-01-01",
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.reactivateContract(
        tx,
        owner.callerIdentity,
        noopAudit,
        created.data!.id,
      );
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("already active");
  });
});

// ─────────────────────────────────────────────────────────────
// RLS isolation tests
// ─────────────────────────────────────────────────────────────
describe("contract RLS isolation", () => {
  it("tenantB cannot see tenantA's contracts", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");
    const clientId = await createClientPartner(
      ownerA.callerIdentity.tenantId,
      ownerA.callerIdentity,
    );

    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return contractService.createContract(tx, ownerA.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Tenant A Contract",
        startDate: "2026-01-01",
      });
    });

    await assertRlsIsolation(
      prisma,
      "contract",
      ownerA.callerIdentity.tenantId,
      ownerB.callerIdentity.tenantId,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Audit logging tests
// ─────────────────────────────────────────────────────────────
describe("contract audit logging", () => {
  it("create generates audit log entry", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return contractService.createContract(tx, owner.callerIdentity, audit, {
        partnerId: clientId,
        name: "Audit Test",
        startDate: "2026-01-01",
      });
    });

    await assertAuditLogged(adminPool, tenantId, "create", "contract", result.data!.id);
  });

  it("update creates audit log", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Before Update",
        startDate: "2026-01-01",
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return contractService.updateContract(tx, owner.callerIdentity, audit, id, {
        name: "After Update",
      });
    });

    await assertAuditLogged(adminPool, tenantId, "update", "contract", id);
  });

  it("deactivate creates audit log with action 'deactivate'", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Deactivation Target",
        startDate: "2026-01-01",
      });
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return contractService.deactivateContract(tx, owner.callerIdentity, audit, created.data!.id);
    });

    await assertAuditLogged(adminPool, tenantId, "deactivate", "contract", created.data!.id);
  });

  it("reactivate creates audit log with action 'reactivate'", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Reactivation Target",
        startDate: "2026-01-01",
      });
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.deactivateContract(
        tx,
        owner.callerIdentity,
        noopAudit,
        created.data!.id,
      );
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return contractService.reactivateContract(tx, owner.callerIdentity, audit, created.data!.id);
    });

    await assertAuditLogged(adminPool, tenantId, "reactivate", "contract", created.data!.id);
  });
});

// ─────────────────────────────────────────────────────────────
// Server Action RBAC tests
// ─────────────────────────────────────────────────────────────
import {
  createContractAction,
  deactivateContractAction,
  getContractsAction,
  reactivateContractAction,
  updateContractAction,
} from "@/modules/contracts/contracts.actions";

describe("contract actions RBAC", () => {
  it("owner can create via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    // Need a client partner first
    const partnerResult = await (await import("@/modules/partners")).createPartnerAction({
      name: "Action Client",
      types: ["client"],
    });
    const partnerId = partnerResult?.data?.data?.id;

    const result = await createContractAction({
      partnerId: partnerId!,
      name: "Action Test Contract",
      startDate: "2026-01-01",
    });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.id).toBeDefined();
  });

  it("owner can read via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const partnerResult = await (await import("@/modules/partners")).createPartnerAction({
      name: "Readable Client",
      types: ["client"],
    });
    const partnerId = partnerResult?.data?.data?.id;

    await createContractAction({
      partnerId: partnerId!,
      name: "Readable Contract",
      startDate: "2026-01-01",
    });

    const result = await getContractsAction({ partnerId: partnerId! });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.length).toBe(1);
  });

  it("member cannot create via action (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await createContractAction({
      partnerId: "00000000-0000-0000-0000-000000000000",
      name: "Should Fail",
      startDate: "2026-01-01",
    });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("member cannot read contracts (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await getContractsAction({ partnerId: "00000000-0000-0000-0000-000000000000" });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated cannot read contracts (UNAUTHORIZED)", async () => {
    mockHeaders = new Headers();
    const result = await getContractsAction({ partnerId: "00000000-0000-0000-0000-000000000000" });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─────────────────────────────────────────────────────────────
// Partner type-removal guard tests
// ─────────────────────────────────────────────────────────────
describe("partner type-removal guard", () => {
  it("cannot remove 'client' type when active contracts exist", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const partnerId = await createClientPartner(tenantId, owner.callerIdentity);

    // Create an active contract
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId,
        name: "Active Contract",
        startDate: "2026-01-01",
      });
    });

    // Try to remove client type
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.updatePartner(tx, owner.callerIdentity, noopAudit, partnerId, {
        types: ["vendor"],
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("Cannot remove client type");
  });

  it("CAN remove 'client' type when no active contracts", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Create a client+vendor partner
    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Client+Vendor",
        types: ["client", "vendor"],
      });
    });
    const partnerId = created.data!.id;

    // Remove client type (no contracts exist)
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.updatePartner(tx, owner.callerIdentity, noopAudit, partnerId, {
        types: ["vendor"],
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);
  });

  it("cannot remove 'employee' type when assigned to active contracts", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const clientId = await createClientPartner(tenantId, owner.callerIdentity);

    // Create employee+vendor partner
    const empResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Employee+Vendor",
        types: ["employee", "vendor"],
      });
    });
    const employeeId = empResult.data!.id;

    // Create contract with employee assigned
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId: clientId,
        name: "Assigned Contract",
        startDate: "2026-01-01",
        assignedEmployeeId: employeeId,
      });
    });

    // Try to remove employee type
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.updatePartner(tx, owner.callerIdentity, noopAudit, employeeId, {
        types: ["vendor"],
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("Cannot remove employee type");
  });
});

// ─────────────────────────────────────────────────────────────
// Cross-service integration test
// ─────────────────────────────────────────────────────────────
describe("cross-service integration", () => {
  it("create client → create contract → remove client type (FAIL) → deactivate partner → create NEW contract (FAIL) → update EXISTING contract (OK)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // 1. Create client partner
    const partnerId = await createClientPartner(tenantId, owner.callerIdentity);

    // 2. Create contract
    const contractResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId,
        name: "Integration Contract",
        startDate: "2026-01-01",
      });
    });
    const contractId = contractResult.data!.id;

    // 3. Attempt remove client type → should FAIL
    const removeTypeResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.updatePartner(tx, owner.callerIdentity, noopAudit, partnerId, {
        types: ["vendor"],
      });
    });
    expect(removeTypeResult.error?.code).toBe("VALIDATION_ERROR");

    // 4. Deactivate partner
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.deactivatePartner(tx, owner.callerIdentity, noopAudit, partnerId);
    });

    // 5. Create NEW contract on inactive partner → should FAIL
    const newContractResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.createContract(tx, owner.callerIdentity, noopAudit, {
        partnerId,
        name: "Should Fail",
        startDate: "2026-06-01",
      });
    });
    expect(newContractResult.error?.code).toBe("VALIDATION_ERROR");

    // 6. Update EXISTING contract on inactive partner → should SUCCEED
    const updateResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.updateContract(tx, owner.callerIdentity, noopAudit, contractId, {
        name: "Updated After Deactivation",
      });
    });
    expect(updateResult.error).toBeUndefined();
    expect(updateResult.data?.updated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Test fixture tests
// ─────────────────────────────────────────────────────────────
describe("createTestContract fixture", () => {
  it("creates a contract via SQL fixture", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const partner = await createTestPartner(adminPool, tenantId, owner.callerIdentity.userId, {
      types: ["client"],
    });

    const contract = await createTestContract(
      adminPool,
      tenantId,
      owner.callerIdentity.userId,
      partner.id,
      {
        name: "Fixture Contract",
        currency: "EUR",
      },
    );

    expect(contract.id).toBeDefined();
    expect(contract.name).toBe("Fixture Contract");

    // Verify readable via service
    const fetched = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return contractService.getContract(tx, contract.id);
    });
    expect(fetched.data?.name).toBe("Fixture Contract");
    expect(fetched.data?.currency).toBe("EUR");
  });
});
