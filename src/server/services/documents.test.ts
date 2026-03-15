import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { withTenantTransaction } from "@/server/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestDocument,
} from "@/server/db/test-fixtures";
import { resetRateLimit } from "@/server/middleware/rate-limit";
import { assertAuditLogged } from "@/server/test-utils/config-crud-helpers";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";
import { createAuditEntry } from "./audit";
import { createTestClock } from "./clock";
import * as documentService from "./documents";
import { resolveDocumentData } from "./documents";

// Mock next/headers
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

// Mock storage service
const mockEnsureContainer = vi.fn();
const mockUploadBlob = vi.fn().mockResolvedValue("https://blob.url/documents/tenant/uuid.pdf");
const mockDeleteBlob = vi.fn();
const mockGenerateSasUrl = vi.fn();

const mockStorage = {
  ensureContainer: mockEnsureContainer,
  uploadBlob: mockUploadBlob,
  downloadBlob: vi.fn(),
  deleteBlob: mockDeleteBlob,
  generateSasUrl: mockGenerateSasUrl,
  generateDownloadUrl: vi.fn().mockResolvedValue("https://blob.url/documents/download"),
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
  mockUploadBlob.mockResolvedValue("https://blob.url/documents/tenant/uuid.pdf");
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

      expect(uploaded.data).toBeDefined();
      const docId = uploaded.data!.id;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocument(tx, docId);
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

  describe("getDocumentOcrData", () => {
    it("returns parsed OCR data when ocrData is populated", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId, userId } = owner.callerIdentity;

      // Create a document and simulate OCR data being stored
      const ocrPayload = {
        extractedData: {
          vendorName: "Test AB",
          invoiceTotal: 1000,
          confidence: 0.95,
          modelUsed: "prebuilt-invoice",
          pageCount: 1,
          processingTimeMs: 1200,
        },
        rawResponse: { analyzeResult: {} },
        quality: "high",
      };

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const clock = createTestClock(new Date("2026-03-14T15:00:00Z"));
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const uploadResult = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          clock,
          PDF_BUFFER,
          "ocr-test.pdf",
          "invoice",
        );
        expect(uploadResult.data).toBeDefined();

        // Simulate OCR completion
        await tx.document.update({
          where: { id: uploadResult.data!.id },
          data: { status: "extracted", ocrData: ocrPayload },
        });

        return uploadResult.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentOcrData(tx, docId);
      });

      expect(result.data).toBeDefined();
      expect(result.data?.extractedData.vendorName).toBe("Test AB");
      expect(result.data?.quality).toBe("high");
    });

    it("returns null when ocrData is not yet populated", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const clock = createTestClock(new Date("2026-03-14T15:00:00Z"));
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const uploadResult = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          clock,
          PDF_BUFFER,
          "no-ocr.pdf",
          "invoice",
        );
        expect(uploadResult.data).toBeDefined();
        return uploadResult.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentOcrData(tx, docId);
      });

      expect(result.data).toBeNull();
    });
  });

  // --- Story 5.3: Document Review & Correction ---

  describe("resolveDocumentData", () => {
    it("returns empty object when both null", () => {
      expect(resolveDocumentData(null, null)).toEqual({});
    });

    it("returns corrections when extractedData is null", () => {
      const corrections = { vendorName: "Test" };
      expect(resolveDocumentData(null, corrections)).toEqual(corrections);
    });

    it("returns extractedData when corrections is null", () => {
      const data = {
        vendorName: "OCR",
        confidence: 0.9,
        modelUsed: "m",
        pageCount: 1,
        processingTimeMs: 100,
      };
      expect(resolveDocumentData(data, null)).toEqual(data);
    });

    it("merges corrections over extractedData (shallow)", () => {
      const data = {
        vendorName: "OCR",
        invoiceTotal: 100,
        confidence: 0.9,
        modelUsed: "m",
        pageCount: 1,
        processingTimeMs: 100,
      };
      const corrections = { vendorName: "Corrected" };
      const result = resolveDocumentData(data, corrections);
      expect(result.vendorName).toBe("Corrected");
      expect(result.invoiceTotal).toBe(100);
    });

    it("fully replaces arrays (items)", () => {
      const data = {
        items: [{ description: "Old", amount: 10 }],
        confidence: 0.9,
        modelUsed: "m",
        pageCount: 1,
        processingTimeMs: 100,
      };
      const corrections = {
        items: [
          { description: "New1", amount: 20 },
          { description: "New2", amount: 30 },
        ],
      };
      const result = resolveDocumentData(data, corrections);
      expect(result.items).toHaveLength(2);
      expect(result.items?.[0].description).toBe("New1");
    });

    it("returns corrections when extractedData is null and corrections has values", () => {
      expect(resolveDocumentData(null, { vendorName: "Test" })).toEqual({ vendorName: "Test" });
    });

    it("returns empty object for null corrections", () => {
      expect(resolveDocumentData(null, null)).toEqual({});
    });

    it("handles empty corrections object", () => {
      const data = {
        vendorName: "OCR",
        confidence: 0.9,
        modelUsed: "m",
        pageCount: 1,
        processingTimeMs: 100,
      };
      expect(resolveDocumentData(data, {})).toEqual(data);
    });
  });

  describe("updateDocumentCorrections", () => {
    it("merges correction patch into document", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.updateDocumentCorrections(tx, owner.callerIdentity, audit, docId, {
          vendorName: "Corrected",
        });
      });

      expect(result.data).toBeDefined();
      expect(result.data?.corrections).toMatchObject({ vendorName: "Corrected" });
    });

    it("forbids accountant from making corrections", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
      const { tenantId } = accountant.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, accountant.callerIdentity);
        return documentService.updateDocumentCorrections(
          tx,
          accountant.callerIdentity,
          audit,
          docId,
          { vendorName: "Hack" },
        );
      });

      expect(result.error?.code).toBe("FORBIDDEN");
    });

    it("returns NOT_FOUND for missing document", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.updateDocumentCorrections(
          tx,
          owner.callerIdentity,
          audit,
          "00000000-0000-0000-0000-000000000000",
          { vendorName: "X" },
        );
      });

      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("logs audit trail for corrections", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.updateDocumentCorrections(tx, owner.callerIdentity, audit, docId, {
          vendorName: "Corrected",
        });
      });

      await assertAuditLogged(adminPool, tenantId, "update", "document", docId);
    });

    it("concurrent correction saves don't lose data", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "concurrent.pdf",
          "expense",
        );
        return r.data!.id;
      });

      // Run two correction saves concurrently
      const [r1, r2] = await Promise.all([
        withTenantTransaction(prisma, tenantId, async (tx) => {
          const audit = createRealAuditLogger(tx, owner.callerIdentity);
          return documentService.updateDocumentCorrections(tx, owner.callerIdentity, audit, docId, {
            vendorName: "Lufthansa",
          });
        }),
        withTenantTransaction(prisma, tenantId, async (tx) => {
          const audit = createRealAuditLogger(tx, owner.callerIdentity);
          return documentService.updateDocumentCorrections(tx, owner.callerIdentity, audit, docId, {
            invoiceTotal: 12500,
          });
        }),
      ]);

      expect(r1.data).toBeDefined();
      expect(r2.data).toBeDefined();

      // Verify both corrections are preserved (atomic JSONB merge, no lost updates)
      mockGenerateSasUrl.mockResolvedValue("https://signed.url/doc");
      const final = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentForReview(tx, owner.callerIdentity, mockStorage, docId);
      });

      expect(final.data?.corrections).toMatchObject({
        vendorName: "Lufthansa",
        invoiceTotal: 12500,
      });
    });
  });

  describe("classifyDocument", () => {
    it("updates documentType and prefixType", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.classifyDocument(tx, owner.callerIdentity, audit, docId, "contract");
      });

      expect(result.data?.documentType).toBe("relationship");
      expect(result.data?.prefixType).toBe("contract");
    });

    it("forbids accountant from classifying", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
      const { tenantId } = accountant.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, accountant.callerIdentity);
        return documentService.classifyDocument(
          tx,
          accountant.callerIdentity,
          audit,
          docId,
          "contract",
        );
      });

      expect(result.error?.code).toBe("FORBIDDEN");
    });

    it("blocks reclassification on linked status", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        // Simulate linked status
        await tx.document.update({ where: { id: r.data!.id }, data: { status: "linked" } });
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.classifyDocument(tx, owner.callerIdentity, audit, docId, "contract");
      });

      expect(result.error?.code).toBe("VALIDATION_ERROR");
      expect(result.error?.message).toContain("linked");
    });

    it("logs audit trail for classification change", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.classifyDocument(tx, owner.callerIdentity, audit, docId, "invoice");
      });

      await assertAuditLogged(adminPool, tenantId, "update", "document", docId);
    });
  });

  describe("markDocumentReviewed", () => {
    it("sets reviewedAt and reviewedBy", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;
      const clock = createTestClock(new Date("2026-03-15T10:00:00Z"));

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.markDocumentReviewed(tx, owner.callerIdentity, audit, clock, docId);
      });

      expect(result.data).toBeDefined();
      expect(result.data?.reviewedAt).toBeInstanceOf(Date);
      expect(result.data?.reviewedBy).toBe(owner.callerIdentity.userId);
    });

    it("is idempotent — re-review updates timestamp", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;
      const clock = createTestClock(new Date("2026-03-15T10:00:00Z"));

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      // First review
      const r1 = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.markDocumentReviewed(tx, owner.callerIdentity, audit, clock, docId);
      });

      // Advance clock, re-review
      clock.setTime(new Date("2026-03-15T12:00:00Z"));
      const r2 = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.markDocumentReviewed(tx, owner.callerIdentity, audit, clock, docId);
      });

      expect(r2.data?.reviewedAt.getTime()).toBeGreaterThan(r1.data!.reviewedAt.getTime());
    });

    it("forbids accountant from marking reviewed", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
      const { tenantId } = accountant.callerIdentity;
      const clock = createTestClock(new Date("2026-03-15T10:00:00Z"));

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, accountant.callerIdentity);
        return documentService.markDocumentReviewed(
          tx,
          accountant.callerIdentity,
          audit,
          clock,
          docId,
        );
      });

      expect(result.error?.code).toBe("FORBIDDEN");
    });
  });

  describe("getDocumentForReview", () => {
    it("returns full review data with signed URL", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;
      mockGenerateSasUrl.mockResolvedValue("https://signed.url/doc");

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        // Simulate OCR completion
        await tx.document.update({
          where: { id: r.data!.id },
          data: {
            status: "extracted",
            ocrData: {
              extractedData: {
                vendorName: "TestCo",
                confidence: 0.9,
                modelUsed: "m",
                pageCount: 1,
                processingTimeMs: 100,
              },
              quality: "high",
            },
          },
        });
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentForReview(tx, owner.callerIdentity, mockStorage, docId);
      });

      expect(result.data).toBeDefined();
      expect(result.data?.signedUrl).toBe("https://signed.url/doc");
      expect(result.data?.extractedData?.vendorName).toBe("TestCo");
      expect(result.data?.quality).toBe("high");
      expect(result.data?.readOnly).toBe(false);
    });

    it("returns merged resolvedData when corrections exist", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;
      mockGenerateSasUrl.mockResolvedValue("https://signed.url/doc");

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        await tx.document.update({
          where: { id: r.data!.id },
          data: {
            status: "extracted",
            ocrData: {
              extractedData: {
                vendorName: "OCR",
                invoiceTotal: 100,
                confidence: 0.9,
                modelUsed: "m",
                pageCount: 1,
                processingTimeMs: 100,
              },
              quality: "high",
            },
            corrections: { vendorName: "Corrected" },
          },
        });
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentForReview(tx, owner.callerIdentity, mockStorage, docId);
      });

      expect(result.data?.resolvedData.vendorName).toBe("Corrected");
      expect(result.data?.resolvedData.invoiceTotal).toBe(100);
    });

    it("blocks accountant from relationship documents", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
      const { tenantId } = accountant.callerIdentity;
      mockGenerateSasUrl.mockResolvedValue("https://signed.url/doc");

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "contract",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentForReview(
          tx,
          accountant.callerIdentity,
          mockStorage,
          docId,
        );
      });

      expect(result.error?.code).toBe("FORBIDDEN");
    });

    it("sets readOnly for accountant on financial documents", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
      const { tenantId } = accountant.callerIdentity;
      mockGenerateSasUrl.mockResolvedValue("https://signed.url/doc");

      const docId = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        const r = await documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          audit,
          mockStorage,
          testClock,
          PDF_BUFFER,
          "test.pdf",
          "expense",
        );
        return r.data!.id;
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentForReview(
          tx,
          accountant.callerIdentity,
          mockStorage,
          docId,
        );
      });

      expect(result.data?.readOnly).toBe(true);
    });
  });

  // --- Story 5.4: Document Library tests ---

  describe("getDocuments", () => {
    it("returns empty result when no documents exist", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocuments(
          tx,
          owner.callerIdentity,
          {},
          { field: "createdAt", direction: "desc" },
          { page: 1, pageSize: 25 },
        );
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.items).toHaveLength(0);
      expect(result.data?.totalCount).toBe(0);
    });

    it("returns documents with default sort (createdAt desc)", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        businessKey: "exp_20260301_001",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        businessKey: "exp_20260302_001",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocuments(
          tx,
          owner.callerIdentity,
          {},
          { field: "createdAt", direction: "desc" },
          { page: 1, pageSize: 25 },
        );
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.totalCount).toBe(2);
      expect(result.data?.items).toHaveLength(2);
    });

    it("filters by status", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "uploaded",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "extracted",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocuments(
          tx,
          owner.callerIdentity,
          { status: ["extracted"] },
          { field: "createdAt", direction: "desc" },
          { page: 1, pageSize: 25 },
        );
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.totalCount).toBe(1);
      expect(result.data?.items[0]?.status).toBe("extracted");
    });

    it("searches by businessKey (ILIKE)", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        businessKey: "inv_20260315_001",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        businessKey: "exp_20260315_001",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocuments(
          tx,
          owner.callerIdentity,
          { search: "inv_" },
          { field: "createdAt", direction: "desc" },
          { page: 1, pageSize: 25 },
        );
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.totalCount).toBe(1);
      expect(result.data?.items[0]?.businessKey).toContain("inv_");
    });

    it("applies pagination correctly (page 2)", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      // Create 3 documents
      for (let i = 0; i < 3; i++) {
        await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId);
      }

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocuments(
          tx,
          owner.callerIdentity,
          {},
          { field: "createdAt", direction: "desc" },
          { page: 2, pageSize: 2 },
        );
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.totalCount).toBe(3);
      expect(result.data?.items).toHaveLength(1); // page 2 with pageSize 2 = 1 item
    });

    it("accountant role forces financial-only filter (cannot retrieve relationship docs)", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "accountant");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        documentType: "financial",
        prefixType: "invoice",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        documentType: "relationship",
        prefixType: "contract",
      });

      // Accountant explicitly requests relationship docs — must be blocked server-side
      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocuments(
          tx,
          accountant.callerIdentity,
          { documentType: ["relationship"] }, // attempted override
          { field: "createdAt", direction: "desc" },
          { page: 1, pageSize: 25 },
        );
      });

      expect(result.error).toBeUndefined();
      // Relationship doc must NOT appear — server enforces financial-only
      expect(result.data?.items.every((d) => d.documentType === "financial")).toBe(true);
    });
  });

  describe("getDocumentFilterOptions", () => {
    it("returns distinct filter values from actual data", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "uploaded",
        prefixType: "expense",
        documentType: "financial",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "extracted",
        prefixType: "invoice",
        documentType: "financial",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentFilterOptions(tx, owner.callerIdentity);
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.statuses).toContain("uploaded");
      expect(result.data?.statuses).toContain("extracted");
      expect(result.data?.prefixTypes).toContain("expense");
      expect(result.data?.prefixTypes).toContain("invoice");
    });

    it("accountant sees only financial document types", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "accountant");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        documentType: "financial",
        prefixType: "expense",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        documentType: "relationship",
        prefixType: "contract",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentFilterOptions(tx, accountant.callerIdentity);
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.documentTypes).not.toContain("relationship");
      expect(result.data?.prefixTypes).not.toContain("contract");
    });
  });

  describe("getDocumentStats", () => {
    it("returns correct aggregate counts", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "uploaded",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "extracted",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "ocr_failed",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentStats(tx, owner.callerIdentity);
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.totalCount).toBe(3);
      expect(result.data?.byStatus["uploaded"]).toBe(1);
      expect(result.data?.byStatus["extracted"]).toBe(1);
      expect(result.data?.byStatus["ocr_failed"]).toBe(1);
    });

    it("counts unreviewed correctly (extracted + ocr_failed without reviewedAt)", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "extracted",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "ocr_failed",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "uploaded",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentStats(tx, owner.callerIdentity);
      });

      expect(result.error).toBeUndefined();
      // extracted + ocr_failed without reviewedAt = 2 unreviewed
      expect(result.data?.unreviewed).toBe(2);
    });

    it("accountant stats only count financial documents", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "accountant");
      const tenantId = owner.callerIdentity.tenantId;

      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        documentType: "financial",
        status: "uploaded",
      });
      await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        documentType: "relationship",
        status: "uploaded",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocumentStats(tx, accountant.callerIdentity);
      });

      expect(result.error).toBeUndefined();
      // Accountant should only see financial docs
      expect(result.data?.totalCount).toBe(1);
    });
  });
});
