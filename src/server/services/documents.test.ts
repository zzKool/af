import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/server/db/test-fixtures";
import { resetRateLimit } from "@/server/middleware/rate-limit";
import { assertAuditLogged } from "@/server/test-utils/config-crud-helpers";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";
import { createAuditEntry } from "./audit";
import { createTestClock } from "./clock";
import * as documentService from "./documents";

// Mock next/headers
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

// Mock storage service
const mockEnsureContainer = vi.fn();
const mockUploadBlob = vi.fn().mockResolvedValue("https://blob.url/tenant/uuid.pdf");
const mockDeleteBlob = vi.fn();
const mockGenerateSasUrl = vi.fn();

const mockStorage = {
  ensureContainer: mockEnsureContainer,
  uploadBlob: mockUploadBlob,
  downloadBlob: vi.fn(),
  deleteBlob: mockDeleteBlob,
  generateSasUrl: mockGenerateSasUrl,
};

// Mock logger
vi.mock("@/server/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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
const testClock = createTestClock(new Date("2026-03-14T15:00:00Z"));

// PDF magic bytes
const PDF_BUFFER = (() => {
  const buf = Buffer.alloc(1024);
  Buffer.from("%PDF-1.4 test content", "ascii").copy(buf);
  return buf;
})();

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
  mockUploadBlob.mockResolvedValue("https://blob.url/tenant/uuid.pdf");
  mockEnsureContainer.mockResolvedValue(undefined);
  documentService._resetContainerEnsured();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await adminPool.end();
});

describe("documents service", () => {
  describe("uploadDocument", () => {
    it("creates a document record with correct fields", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test-invoice.pdf",
          "expense",
        );
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toBeDefined();
      expect(result.data?.businessKey).toMatch(/^exp_20260314_001$/);
      expect(result.data?.fileName).toBe("test-invoice.pdf");
      expect(result.data?.status).toBe("uploaded");
      expect(result.data?.documentType).toBe("financial");
    });

    it("uploads blob with Content-Disposition: attachment", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
      });

      expect(mockUploadBlob).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${tenantId}/.*\\.pdf$`)),
        PDF_BUFFER,
        "application/pdf",
        { contentDisposition: "attachment" },
      );
    });

    it("forbids accountant from uploading", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
      const tenantId = accountant.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, accountant.callerIdentity);
        return documentService.uploadDocument(
          tx,
          accountant.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("FORBIDDEN");
    });

    it("logs audit trail for upload", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
      });

      expect(result.data).toBeDefined();
      await assertAuditLogged(adminPool, tenantId, "create", "document", result.data?.id);
    });

    it("increments business key sequence for same month", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result1 = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "doc1.pdf",
          "expense",
        );
      });

      const result2 = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "doc2.pdf",
          "expense",
        );
      });

      expect(result1.data?.businessKey).toContain("_001");
      expect(result2.data?.businessKey).toContain("_002");
    });
  });

  describe("RLS isolation", () => {
    it("isolates documents between tenants", async () => {
      const ownerA = await createAuthenticatedContext(auth, "owner");
      const ownerB = await createAuthenticatedContext(auth, "owner");

      // Upload document for tenant A
      await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, ownerA.callerIdentity);
        return documentService.uploadDocument(
          tx,
          ownerA.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "tenantA.pdf",
          "expense",
        );
      });

      // Tenant B should not see tenant A's documents
      const bDocs = await withTenantTransaction(
        prisma,
        ownerB.callerIdentity.tenantId,
        async (tx) => {
          return documentService.getRecentDocuments(tx, 10);
        },
      );

      expect(bDocs.data).toHaveLength(0);
    });
  });

  describe("getRecentDocuments", () => {
    it("returns recent documents ordered by createdAt desc", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      // Upload 3 documents
      for (let i = 0; i < 3; i++) {
        await withTenantTransaction(prisma, tenantId, async (tx) => {
          const audit = createRealAuditLogger(tx, owner.callerIdentity);
          return documentService.uploadDocument(
            tx,
            owner.callerIdentity,
            audit,
            mockStorage,
            testClock,
            PDF_BUFFER,
            `doc${i}.pdf`,
            "expense",
          );
        });
      }

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getRecentDocuments(tx, 5);
      });

      expect(result.data).toHaveLength(3);
      // Most recent first
      expect(result.data?.[0].fileName).toBe("doc2.pdf");
    });
  });

  describe("getDocument", () => {
    it("returns document by id", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const uploaded = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "find-me.pdf",
          "expense",
        );
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocument(tx, uploaded.data?.id);
      });

      expect(result.data).toBeDefined();
      expect(result.data?.fileName).toBe("find-me.pdf");
    });

    it("returns NOT_FOUND for missing document", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocument(tx, "00000000-0000-0000-0000-000000000000");
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });
});
