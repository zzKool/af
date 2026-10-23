import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { createTestClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestDocument,
} from "@/kernel/db/test-fixtures";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as documentService from "@/modules/documents/documents";
import { resolveDocumentData } from "@/modules/documents/documents";
import { inboxTotals } from "@/modules/documents/queries";

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
vi.mock("@/kernel/logging/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const _noopAudit: AuditLogger = { log: async () => {} };

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

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

let adminPool: Pool;

/** A real link onto the document — "linked" is derived from links, never typed as a status. */
async function linkDocument(
  tenantId: string,
  documentId: string,
  userId: string,
  kind: "created_from" | "justifies",
): Promise<void> {
  const fromType = kind === "created_from" ? "expense" : "bank_transaction";
  await adminPool.query(
    `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
     VALUES ($1, $2, gen_random_uuid(), 'document', $3, $4, $5)`,
    [tenantId, fromType, documentId, kind, userId],
  );
}
const testClock = createTestClock(new Date("2026-03-14T15:00:00Z"));

// PDF magic bytes; `pdf(label)` gives distinct bytes — the same bytes twice in one tenant is a duplicate (US2)
function pdf(label: string): Buffer {
  const buf = Buffer.alloc(1024);
  Buffer.from(`%PDF-1.4 test content ${label}`, "ascii").copy(buf);
  return buf;
}
const PDF_BUFFER = pdf("");

/** The stored branch of an upload result (fails the test on a duplicate or an error). */
function stored(result: Awaited<ReturnType<typeof documentService.uploadDocument>>) {
  expect(result.error).toBeUndefined();
  expect(result.data?.kind).toBe("stored");
  if (result.data?.kind !== "stored") throw new Error("not stored");
  return result.data;
}

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

      const doc = stored(result);
      expect(doc.businessKey).toMatch(/^exp_20260314_001$/);
      expect(doc.fileName).toBe("test-invoice.pdf");
      expect(doc.status).toBe("uploaded");
      expect(doc.documentType).toBe("financial");
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

      await assertAuditLogged(adminPool, tenantId, "create", "document", stored(result).id);
    });

    // --- the same file twice (specs/documents US2, D32) ---
    it("stores the sha256 of the bytes; the same bytes again return the existing document and write nothing", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;
      const bytes = pdf("twice");
      const up = (name: string, force?: boolean) =>
        withTenantTransaction(prisma, tenantId, (tx) =>
          documentService.uploadDocument(
            tx,
            owner.callerIdentity,
            createRealAuditLogger(tx, owner.callerIdentity),
            mockStorage,
            testClock,
            bytes,
            name,
            "expense",
            { force },
          ),
        );

      const first = stored(await up("email.pdf"));
      const row = await adminPool.query("SELECT content_hash FROM documents WHERE id = $1", [
        first.id,
      ]);
      expect(row.rows[0].content_hash).toBe(documentService.contentHashOf(bytes));
      expect(row.rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);

      // the same bytes under another name and kind: the card, not a second document
      const again = await withTenantTransaction(prisma, tenantId, (tx) =>
        documentService.uploadDocument(
          tx,
          owner.callerIdentity,
          createRealAuditLogger(tx, owner.callerIdentity),
          mockStorage,
          testClock,
          bytes,
          "photo.pdf",
          "invoice",
        ),
      );
      expect(again.data?.kind).toBe("duplicate");
      if (again.data?.kind !== "duplicate") throw new Error("expected duplicate");
      expect(again.data.existing.id).toBe(first.id);
      expect(again.data.existing.businessKey).toBe(first.businessKey);
      // FR-009: who uploaded it, read outside the tenant transaction; nothing became from it yet
      expect(again.data.existing.became).toBeNull();
      expect(await documentService.uploaderName(prisma, again.data.existing.createdBy)).toBe(
        "Test owner",
      );
      expect(await documentService.uploaderName(prisma, crypto.randomUUID())).toBeNull();
      const count = await adminPool.query(
        "SELECT count(*)::int AS n FROM documents WHERE tenant_id = $1",
        [tenantId],
      );
      expect(count.rows[0].n).toBe(1);
      expect(mockUploadBlob).toHaveBeenCalledTimes(1);

      // "Upload anyway": a second document with its own key, audited as a knowing duplicate
      const second = stored(await up("photo.pdf", true));
      expect(second.id).not.toBe(first.id);
      expect(second.businessKey).toContain("_002");
      const audit = await adminPool.query(
        "SELECT new_data FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'create'",
        [tenantId, second.id],
      );
      expect(audit.rows[0].new_data.knowingDuplicateOf).toBe(first.id);

      // the twins see each other; a different file sees nobody
      const twins = await withTenantTransaction(prisma, tenantId, (tx) =>
        documentService.sameContentDocumentIds(tx, first.id),
      );
      expect(twins).toEqual([second.id]);
    });

    it("FR-009: the duplicate names what the existing document became (type and entity)", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;
      const bytes = pdf("became-then-again");
      const up = () =>
        withTenantTransaction(prisma, tenantId, (tx) =>
          documentService.uploadDocument(
            tx,
            owner.callerIdentity,
            createRealAuditLogger(tx, owner.callerIdentity),
            mockStorage,
            testClock,
            bytes,
            "receipt.pdf",
            "expense",
          ),
        );
      const first = stored(await up());
      const expenseId = crypto.randomUUID();
      await adminPool.query(
        `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
         VALUES ($1, 'expense', $2, 'document', $3, 'created_from', $4)`,
        [tenantId, expenseId, first.id, owner.callerIdentity.userId],
      );
      const again = await up();
      if (again.data?.kind !== "duplicate") throw new Error("expected duplicate");
      // the key comes through the entity's linkable (linking.test covers it); this stand-in has no row
      expect(again.data.existing.became).toEqual({ type: "expense", id: expenseId, key: null });
    });

    it("a hard-deleted document never counts as a duplicate", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;
      const bytes = pdf("deleted-then-again");
      const up = () =>
        withTenantTransaction(prisma, tenantId, (tx) =>
          documentService.uploadDocument(
            tx,
            owner.callerIdentity,
            createRealAuditLogger(tx, owner.callerIdentity),
            mockStorage,
            testClock,
            bytes,
            "gone.pdf",
            "expense",
          ),
        );
      const first = stored(await up());
      await withTenantTransaction(prisma, tenantId, (tx) =>
        documentService.deleteDocument(
          tx,
          owner.callerIdentity,
          createRealAuditLogger(tx, owner.callerIdentity),
          first.id,
        ),
      );
      const second = stored(await up());
      expect(second.id).not.toBe(first.id);
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
          pdf("doc1"),
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
          pdf("doc2"),
          "doc2.pdf",
          "expense",
        );
      });

      expect(stored(result1).businessKey).toContain("_001");
      expect(stored(result2).businessKey).toContain("_002");
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
            pdf(`doc${i}`),
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
      const docId = stored(uploaded).id;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocument(tx, docId);
      });

      expect(result.data).toBeDefined();
      expect(result.data?.fileName).toBe("find-me.pdf");
      // F50-f: a DTO — the OCR payload parsed, null before the OCR ran
      expect(result.data?.ocrData).toBeNull();
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
          where: { id: stored(uploadResult).id },
          data: { status: "extracted", ocrData: ocrPayload },
        });

        return stored(uploadResult).id;
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
        return stored(uploadResult).id;
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
        return stored(r).id;
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
        return stored(r).id;
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

    it("refuses a correction that does not fit its field, and stores nothing", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;
      const doc = await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "extracted",
      });

      for (const bad of [{ invoiceTotal: null }, { currency: "GBP" }, { status: "linked" }]) {
        const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
          const audit = createRealAuditLogger(tx, owner.callerIdentity);
          return documentService.updateDocumentCorrections(
            tx,
            owner.callerIdentity,
            audit,
            doc.id,
            bad as never,
          );
        });
        expect(result.error?.code, JSON.stringify(bad)).toBe("VALIDATION_ERROR");
      }
      const stored = await adminPool.query(`SELECT corrections FROM documents WHERE id = $1`, [
        doc.id,
      ]);
      expect(stored.rows[0].corrections).toBeNull();
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
        return stored(r).id;
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
        return stored(r).id;
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
        return stored(r).id;
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
        return stored(r).id;
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

    it("refuses to reclassify a document that became an expense (derived from the link)", async () => {
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
        return stored(r).id;
      });
      // it became an expense — the link, not a status
      await linkDocument(tenantId, docId, owner.callerIdentity.userId, "created_from");

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
        return stored(r).id;
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
        return stored(r).id;
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
        return stored(r).id;
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
        return stored(r).id;
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
          where: { id: stored(r).id },
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
        return stored(r).id;
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
          where: { id: stored(r).id },
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
        return stored(r).id;
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
        return stored(r).id;
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
        return stored(r).id;
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
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
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

    it("one 'to review' count: the inbox's total, not a second count in the stats", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const tenantId = owner.callerIdentity.tenantId;

      for (const status of ["extracted", "ocr_failed", "uploaded"]) {
        await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, { status });
      }

      const [stats, inbox] = await withTenantTransaction(prisma, tenantId, async (tx) =>
        Promise.all([
          documentService.getDocumentStats(tx, owner.callerIdentity),
          inboxTotals(tx, owner.callerIdentity),
        ]),
      );

      expect(stats.data).not.toHaveProperty("unreviewed");
      // ready (extracted) + pending (ocr_failed, needs OCR) — what the library's "to review" and the inbox link show
      expect(inbox.total).toBe(3);
    });

    it("accountant stats only count financial documents", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
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

  // --- Story 5.5: Document Deletion & Retention Enforcement ---

  describe("deleteDocument", () => {
    it("deletes unlinked document and returns businessKey + blobUrl", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const doc = await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "uploaded",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.deleteDocument(tx, owner.callerIdentity, audit, doc.id);
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.businessKey).toBe(doc.businessKey);
      expect(result.data?.blobUrl).toBeDefined();

      // Verify document is gone from DB
      const gone = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocument(tx, doc.id);
      });
      expect(gone.error?.code).toBe("NOT_FOUND");
    });

    it("blocks deletion of linked document with BUSINESS_RULE_VIOLATION", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const doc = await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "extracted",
      });
      await linkDocument(tenantId, doc.id, owner.callerIdentity.userId, "justifies");

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.deleteDocument(tx, owner.callerIdentity, audit, doc.id);
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(result.error?.message).toContain("linked");

      // Document must still exist
      const still = await withTenantTransaction(prisma, tenantId, async (tx) => {
        return documentService.getDocument(tx, doc.id);
      });
      expect(still.data).toBeDefined();
    });

    it("returns NOT_FOUND for non-existent document", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.deleteDocument(
          tx,
          owner.callerIdentity,
          audit,
          "00000000-0000-0000-0000-000000000000",
        );
      });

      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("returns FORBIDDEN when caller is not owner", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const accountant = await createAuthenticatedContext(auth, "member", {
        headers: owner.headers,
        orgId: owner.callerIdentity.tenantId,
      });
      const { tenantId } = accountant.callerIdentity;

      const doc = await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "uploaded",
      });

      const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, accountant.callerIdentity);
        return documentService.deleteDocument(tx, accountant.callerIdentity, audit, doc.id);
      });

      expect(result.error?.code).toBe("FORBIDDEN");
    });

    it("records audit entry with outcome:deleted for successful delete", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      const doc = await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "uploaded",
      });

      await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.deleteDocument(tx, owner.callerIdentity, audit, doc.id);
      });

      const auditRow = await adminPool.query(
        `SELECT new_data FROM audit_logs WHERE tenant_id = $1 AND action = 'delete' AND entity_type = 'document' AND entity_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, doc.id],
      );
      expect(auditRow.rows.length).toBe(1);
      expect(auditRow.rows[0].new_data.outcome).toBe("deleted");
    });

    it("records audit entry with outcome:blocked for linked document", async () => {
      const owner = await createAuthenticatedContext(auth, "owner");
      const { tenantId } = owner.callerIdentity;

      // the stored status says nothing; the link decides — and is checked before the trigger could abort the
      // transaction (the audit row below would then be lost)
      const doc = await createTestDocument(adminPool, tenantId, owner.callerIdentity.userId, {
        status: "extracted",
      });
      await linkDocument(tenantId, doc.id, owner.callerIdentity.userId, "created_from");

      await withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return documentService.deleteDocument(tx, owner.callerIdentity, audit, doc.id);
      });

      const auditRow = await adminPool.query(
        `SELECT new_data FROM audit_logs WHERE tenant_id = $1 AND action = 'delete' AND entity_type = 'document' AND entity_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, doc.id],
      );
      expect(auditRow.rows.length).toBe(1);
      expect(auditRow.rows[0].new_data.outcome).toBe("blocked");
      expect(auditRow.rows[0].new_data.reason).toBe("linked");
    });
  });
});
