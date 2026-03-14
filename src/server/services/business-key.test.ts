import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/server/db/test-fixtures";
import { resetRateLimit } from "@/server/middleware/rate-limit";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";
import { createAuditEntry } from "./audit";
import { generateBusinessKey, getDocumentClassification } from "./business-key";
import { createTestClock } from "./clock";

// Mock next/headers
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

const _noopAudit: AuditLogger = { log: async () => {} };

function createRealAuditLogger(
  tx: import("@/server/db/tenant-client").TransactionClient,
  caller: CallerIdentity,
): AuditLogger {
  return {
    log: async (params) => {
      await createAuditEntry(tx, caller, params);
    },
  };
}

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

describe("business-key", () => {
  describe("getDocumentClassification", () => {
    it("maps expense to financial", () => {
      expect(getDocumentClassification("expense")).toBe("financial");
    });

    it("maps invoice to financial", () => {
      expect(getDocumentClassification("invoice")).toBe("financial");
    });

    it("maps contract to relationship", () => {
      expect(getDocumentClassification("contract")).toBe("relationship");
    });

    it("maps nda to relationship", () => {
      expect(getDocumentClassification("nda")).toBe("relationship");
    });

    it("maps certificate to relationship", () => {
      expect(getDocumentClassification("certificate")).toBe("relationship");
    });

    it("returns undefined for unknown type", () => {
      expect(getDocumentClassification("unknown")).toBeUndefined();
    });
  });

  describe("generateBusinessKey", () => {
    // Use a Stockholm-aware date: March 14, 2026 at 15:00 UTC = 16:00 Stockholm
    const testClock = createTestClock(new Date("2026-03-14T15:00:00Z"));

    it("generates key in correct format", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return generateBusinessKey(tx, owner.callerIdentity, audit, "expense", testClock);
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toBeDefined();
      // Format: {prefix}{YYYYMMDD}_{NNN}
      expect(result.data?.businessKey).toMatch(/^exp_20260314_001$/);
      expect(result.data?.documentType).toBe("financial");
    });

    it("increments sequence number", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result1 = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return generateBusinessKey(tx, owner.callerIdentity, audit, "expense", testClock);
      });

      const result2 = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return generateBusinessKey(tx, owner.callerIdentity, audit, "expense", testClock);
      });

      expect(result1.data?.businessKey).toContain("_001");
      expect(result2.data?.businessKey).toContain("_002");
    });

    it("returns error for unknown prefix type", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return generateBusinessKey(tx, owner.callerIdentity, audit, "unknown", testClock);
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("VALIDATION_ERROR");
    });

    it("uses Stockholm timezone date", async () => {
      // 23:30 UTC on March 14 = 00:30 March 15 in Stockholm (CET = UTC+1)
      const lateNightClock = createTestClock(new Date("2026-03-14T23:30:00Z"));
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return generateBusinessKey(tx, owner.callerIdentity, audit, "expense", lateNightClock);
      });

      expect(result.data).toBeDefined();
      // Stockholm is UTC+1 in winter, so 23:30 UTC = 00:30 next day
      expect(result.data?.businessKey).toContain("20260315");
    });

    it("resets counter on new month", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const marchClock = createTestClock(new Date("2026-03-14T12:00:00Z"));
      const aprilClock = createTestClock(new Date("2026-04-01T12:00:00Z"));

      // Generate in March
      const marchResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return generateBusinessKey(tx, owner.callerIdentity, audit, "expense", marchClock);
      });

      // Generate in April — counter should reset
      const aprilResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return generateBusinessKey(tx, owner.callerIdentity, audit, "expense", aprilClock);
      });

      expect(marchResult.data?.businessKey).toContain("_001");
      expect(aprilResult.data?.businessKey).toContain("_001");
    });
  });
});
