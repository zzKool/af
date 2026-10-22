import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import {
  assertAuditLogged,
  assertCrudOperations,
  assertRlsIsolation,
} from "@/kernel/test-utils/config-crud-helpers";
import { parseRateInput } from "@/modules/settings/components/vat-registrations-tab";
import * as vatService from "@/modules/settings/vat-registrations";

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

const APP_DATABASE_URL =
  process.env.DATABASE_TEST_URL || "postgresql://defterfab_app:app@localhost:5433/defterfab_test";

let adminPool: Pool;
let appPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  appPool = new Pool({ connectionString: APP_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
});

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

// Import actions after mocks
import {
  createVatRegistrationAction as createVatAction,
  deleteVatRegistrationAction as deleteVatAction,
  getVatRegistrationsAction as getVatAction,
  updateVatRegistrationAction as updateVatAction,
} from "@/modules/settings/vat-registrations.actions";

// ─────────────────────────────────────────────────────────────
// VAT registrations service tests
// ─────────────────────────────────────────────────────────────
describe("vat registrations service", () => {
  it("create: add Swedish moms registration with rates [25, 12, 6]", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return vatService.createVatRegistration(tx, owner.callerIdentity, audit, {
        country: "SE",
        vatNumber: "SE556677889001",
        rateSchedule: { rates: [25, 12, 6] },
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();

    // Verify stored
    const regs = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.getVatRegistrations(tx, owner.callerIdentity);
    });
    expect(regs.data?.length).toBe(1);
    expect(regs.data?.[0].country).toBe("SE");
    expect(regs.data?.[0].vatNumber).toBe("SE556677889001");
    const schedule = regs.data?.[0].rateSchedule as { rates: number[] };
    expect(schedule.rates).toEqual([25, 12, 6]);
  });

  it("create multiple: add SE + CH registrations for same tenant", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
        rateSchedule: { rates: [25, 12, 6] },
      });
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "CH",
        vatNumber: "CHE-123.456.789 MWST",
        rateSchedule: { rates: [8.1, 2.6, 3.8] },
      });
    });

    const regs = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.getVatRegistrations(tx, owner.callerIdentity);
    });
    expect(regs.data?.length).toBe(2);
    // Ordered by country asc
    expect(regs.data?.[0].country).toBe("CH");
    expect(regs.data?.[1].country).toBe("SE");
  });

  it("duplicate prevention: same country + vatNumber twice → DUPLICATE_ENTRY", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("update: change vatNumber, verify audit captures oldData/newData", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return vatService.updateVatRegistration(tx, owner.callerIdentity, audit, id, {
        vatNumber: "SE999999999901",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);

    await assertAuditLogged(adminPool, tenantId, "update", "vat_registration", id);
  });

  it("update rate schedule: change rates array, verify stored correctly", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
        rateSchedule: { rates: [25, 12, 6] },
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.updateVatRegistration(tx, owner.callerIdentity, noopAudit, id, {
        rateSchedule: { rates: [25, 12, 6, 0] },
      });
    });

    const regs = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.getVatRegistrations(tx, owner.callerIdentity);
    });
    const schedule = regs.data?.[0].rateSchedule as { rates: number[] };
    expect(schedule.rates).toEqual([25, 12, 6, 0]);
  });

  it("update rate schedule to null: clears it, reads back null", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, (tx) =>
      vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "CH",
        vatNumber: "CHE-123.456.789 MWST",
        rateSchedule: { rates: [8.1, 2.6, 3.8] },
      }),
    );
    const updated = await withTenantTransaction(prisma, tenantId, (tx) =>
      vatService.updateVatRegistration(tx, owner.callerIdentity, noopAudit, created.data!.id, {
        rateSchedule: null,
      }),
    );
    expect(updated.error).toBeUndefined();

    const regs = await withTenantTransaction(prisma, tenantId, (tx) =>
      vatService.getVatRegistrations(tx, owner.callerIdentity),
    );
    expect(regs.data?.[0].rateSchedule).toBeNull();
  });

  it("delete: remove registration, verify audit captures old state", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return vatService.deleteVatRegistration(tx, owner.callerIdentity, audit, id);
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.deleted).toBe(true);

    await assertAuditLogged(adminPool, tenantId, "delete", "vat_registration", id);

    // Verify gone
    const regs = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.getVatRegistrations(tx, owner.callerIdentity);
    });
    expect(regs.data?.length).toBe(0);
  });

  it("rate schedule validation: reject invalid shapes", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Empty rates array
    const r1 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        rateSchedule: { rates: [] } as any,
      });
    });
    expect(r1.error?.code).toBe("VALIDATION_ERROR");

    // Rate > 100
    const r2 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        rateSchedule: { rates: [101] } as any,
      });
    });
    expect(r2.error?.code).toBe("VALIDATION_ERROR");

    // Negative rate
    const r3 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        rateSchedule: { rates: [-1] } as any,
      });
    });
    expect(r3.error?.code).toBe("VALIDATION_ERROR");

    // More than 10 rates
    const r4 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        rateSchedule: { rates: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] } as any,
      });
    });
    expect(r4.error?.code).toBe("VALIDATION_ERROR");
  });

  it("country validation: reject non-2-char, non-uppercase values", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Too short
    const r1 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "S",
        vatNumber: "SE556677889001",
      });
    });
    expect(r1.error?.code).toBe("VALIDATION_ERROR");

    // Too long
    const r2 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SWE",
        vatNumber: "SE556677889001",
      });
    });
    expect(r2.error?.code).toBe("VALIDATION_ERROR");

    // Lowercase
    const r3 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "se",
        vatNumber: "SE556677889001",
      });
    });
    expect(r3.error?.code).toBe("VALIDATION_ERROR");
  });

  it("create with null rate_schedule: succeeds, stored as null", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });

    expect(result.error).toBeUndefined();

    const regs = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.getVatRegistrations(tx, owner.callerIdentity);
    });
    expect(regs.data?.[0].rateSchedule).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Full CRUD cycle test
// ─────────────────────────────────────────────────────────────
describe("full CRUD cycle", () => {
  it("create → read → update → delete via assertCrudOperations", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await assertCrudOperations({
      create: async () => {
        const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
          return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
            country: "DE",
            vatNumber: "DE123456789",
            rateSchedule: { rates: [19, 7] },
          });
        });
        return { id: result.data!.id };
      },
      read: async (id) => {
        return withTenantTransaction(prisma, tenantId, async (tx) => {
          return tx.vatRegistration.findUnique({ where: { id } });
        });
      },
      update: async (id) => {
        const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
          return vatService.updateVatRegistration(tx, owner.callerIdentity, noopAudit, id, {
            vatNumber: "DE987654321",
          });
        });
        return result.data;
      },
      remove: async (id) => {
        await withTenantTransaction(prisma, tenantId, async (tx) => {
          return vatService.deleteVatRegistration(tx, owner.callerIdentity, noopAudit, id);
        });
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────
// RLS isolation tests
// ─────────────────────────────────────────────────────────────
describe("RLS isolation", () => {
  it("tenantB cannot see tenantA's VAT registrations", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, ownerA.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });

    await assertRlsIsolation(
      prisma,
      "vatRegistration",
      ownerA.callerIdentity.tenantId,
      ownerB.callerIdentity.tenantId,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Audit logging tests
// ─────────────────────────────────────────────────────────────
describe("audit logging", () => {
  it("create generates audit log entry", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return vatService.createVatRegistration(tx, owner.callerIdentity, audit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });

    await assertAuditLogged(adminPool, tenantId, "create", "vat_registration", result.data!.id);
  });

  it("update creates audit log with oldData and newData", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return vatService.updateVatRegistration(tx, owner.callerIdentity, audit, id, {
        vatNumber: "SE999999999901",
      });
    });

    await assertAuditLogged(adminPool, tenantId, "update", "vat_registration", id);
  });

  it("delete creates audit log with oldData", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return vatService.createVatRegistration(tx, owner.callerIdentity, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return vatService.deleteVatRegistration(tx, owner.callerIdentity, audit, id);
    });

    await assertAuditLogged(adminPool, tenantId, "delete", "vat_registration", id);
  });
});

// ─────────────────────────────────────────────────────────────
// Server actions tests
// ─────────────────────────────────────────────────────────────
describe("vat registration actions", () => {
  it("owner can create via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await createVatAction({
      country: "SE",
      vatNumber: "SE556677889001",
      rateSchedule: { rates: [25, 12, 6] },
    });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.id).toBeDefined();
  });

  it("owner can read via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    await createVatAction({ country: "SE", vatNumber: "SE556677889001" });

    const result = await getVatAction({});
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

    const result = await createVatAction({
      country: "SE",
      vatNumber: "SE556677889001",
    });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated cannot read (UNAUTHORIZED)", async () => {
    mockHeaders = new Headers();
    const result = await getVatAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─────────────────────────────────────────────────────────────
// parseRateInput pure function tests
// ─────────────────────────────────────────────────────────────
describe("parseRateInput", () => {
  it("parses comma-separated with % signs", () => {
    expect(parseRateInput("25%, 12, 6,")).toEqual([25, 12, 6]);
  });

  it("parses space-separated", () => {
    expect(parseRateInput("25 12 6")).toEqual([25, 12, 6]);
  });

  it("returns empty array for empty string", () => {
    expect(parseRateInput("")).toEqual([]);
  });

  it("returns empty array for non-numeric input", () => {
    expect(parseRateInput("abc")).toEqual([]);
  });

  it("handles mixed separators and whitespace", () => {
    expect(parseRateInput(" 25% , 12.5   6 ")).toEqual([25, 12.5, 6]);
  });

  it("filters NaN values from mixed input", () => {
    expect(parseRateInput("25, abc, 12")).toEqual([25, 12]);
  });
});
