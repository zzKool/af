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
import { DEFAULT_DOCUMENT_TYPE_PREFIXES } from "@/kernel/nav/constants";
import {
  assertAuditLogged,
  assertCrudOperations,
  assertRlsIsolation,
} from "@/kernel/test-utils/config-crud-helpers";
import * as prefixService from "@/modules/documents/document-type-prefixes";

const noopAudit: AuditLogger = { log: async () => {} };

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

// Import actions after mocks
import {
  createDocumentTypePrefixAction as createAction,
  getDocumentTypePrefixesAction as getAction,
} from "@/modules/documents/document-type-prefixes.actions";

// ─────────────────────────────────────────────────────────────
// Document-type prefixes service tests
// ─────────────────────────────────────────────────────────────
describe("document-type prefixes service", () => {
  it("create: add a custom document type prefix", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return prefixService.createDocumentTypePrefix(tx, owner.callerIdentity, audit, {
        documentType: "tax",
        prefix: "tax_",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();

    const prefixes = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.getDocumentTypePrefixes(tx, owner.callerIdentity);
    });
    expect(prefixes.data?.length).toBe(1);
    expect(prefixes.data?.[0].documentType).toBe("tax");
    expect(prefixes.data?.[0].prefix).toBe("tax_");
  });

  it("duplicate prevention: same documentType for same tenant → DUPLICATE_ENTRY", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.createDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, {
        documentType: "expense",
        prefix: "exp_",
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.createDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, {
        documentType: "expense",
        prefix: "exp2_",
      });
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("update: change prefix value", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.createDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, {
        documentType: "invoice",
        prefix: "inv_",
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return prefixService.updateDocumentTypePrefix(tx, owner.callerIdentity, audit, id, {
        prefix: "fak_",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);

    await assertAuditLogged(adminPool, tenantId, "update", "document_type_prefix", id);
  });

  it("delete: remove prefix, verify gone", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.createDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, {
        documentType: "nda",
        prefix: "nda_",
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return prefixService.deleteDocumentTypePrefix(tx, owner.callerIdentity, audit, id);
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.deleted).toBe(true);

    await assertAuditLogged(adminPool, tenantId, "delete", "document_type_prefix", id);

    const prefixes = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.getDocumentTypePrefixes(tx, owner.callerIdentity);
    });
    expect(prefixes.data?.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Seed-on-first-access tests
// ─────────────────────────────────────────────────────────────
describe("seed-on-first-access", () => {
  it("fresh tenant: seed defaults → returns 5 default prefixes", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Not seeded yet
    const seeded = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.isPrefixesSeeded(tx, owner.callerIdentity);
    });
    expect(seeded).toBe(false);

    // Seed
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return prefixService.seedDocumentTypePrefixes(tx, owner.callerIdentity, audit);
    });
    expect(result.data?.seeded).toBe(Object.keys(DEFAULT_DOCUMENT_TYPE_PREFIXES).length);

    // Verify seeded flag
    const seededAfter = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.isPrefixesSeeded(tx, owner.callerIdentity);
    });
    expect(seededAfter).toBe(true);

    // Verify prefixes exist
    const prefixes = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.getDocumentTypePrefixes(tx, owner.callerIdentity);
    });
    expect(prefixes.data?.length).toBe(5);
  });

  it("delete-all-reseed prevention: seed → delete all → get returns empty (NOT re-seeded)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Seed defaults
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.seedDocumentTypePrefixes(tx, owner.callerIdentity, noopAudit);
    });

    // Get all IDs
    const allPrefixes = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.getDocumentTypePrefixes(tx, owner.callerIdentity);
    });
    expect(allPrefixes.data?.length).toBe(5);

    // Delete all 5
    for (const p of allPrefixes.data!) {
      await withTenantTransaction(prisma, tenantId, async (tx) => {
        return prefixService.deleteDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, p.id);
      });
    }

    // Get again — should be EMPTY (prefixes_seeded flag prevents re-seeding)
    const afterDelete = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.getDocumentTypePrefixes(tx, owner.callerIdentity);
    });
    expect(afterDelete.data?.length).toBe(0);

    // Verify seeded flag is still true
    const seeded = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return prefixService.isPrefixesSeeded(tx, owner.callerIdentity);
    });
    expect(seeded).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Prefix validation tests
// ─────────────────────────────────────────────────────────────
describe("prefix format validation", () => {
  it("rejects empty prefix", () => {
    const result = prefixService.prefixSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects just underscore", () => {
    const result = prefixService.prefixSchema.safeParse("_");
    expect(result.success).toBe(false);
  });

  it("auto-lowercases: EXP_ → exp_", () => {
    const result = prefixService.prefixSchema.safeParse("EXP_");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("exp_");
  });

  it("rejects no trailing underscore: exp", () => {
    const result = prefixService.prefixSchema.safeParse("exp");
    expect(result.success).toBe(false);
  });

  it("rejects double underscore: exp__", () => {
    const result = prefixService.prefixSchema.safeParse("exp__");
    expect(result.success).toBe(false);
  });

  it("rejects unicode: ärk_", () => {
    const result = prefixService.prefixSchema.safeParse("ärk_");
    expect(result.success).toBe(false);
  });

  it("accepts 10 chars: abcdefghi_", () => {
    const result = prefixService.prefixSchema.safeParse("abcdefghi_");
    expect(result.success).toBe(true);
  });

  it("rejects 11 chars: abcdefghij_", () => {
    const result = prefixService.prefixSchema.safeParse("abcdefghij_");
    expect(result.success).toBe(false);
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
          return prefixService.createDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, {
            documentType: "receipt",
            prefix: "rct_",
          });
        });
        return { id: result.data!.id };
      },
      read: async (id) => {
        return withTenantTransaction(prisma, tenantId, async (tx) => {
          return tx.documentTypePrefix.findUnique({ where: { id } });
        });
      },
      update: async (id) => {
        const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
          return prefixService.updateDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, id, {
            prefix: "rec_",
          });
        });
        return result.data;
      },
      remove: async (id) => {
        await withTenantTransaction(prisma, tenantId, async (tx) => {
          return prefixService.deleteDocumentTypePrefix(tx, owner.callerIdentity, noopAudit, id);
        });
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────
// RLS isolation tests
// ─────────────────────────────────────────────────────────────
describe("RLS isolation", () => {
  it("tenantB cannot see tenantA's document-type prefixes", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return prefixService.createDocumentTypePrefix(tx, ownerA.callerIdentity, noopAudit, {
        documentType: "expense",
        prefix: "exp_",
      });
    });

    await assertRlsIsolation(
      prisma,
      "documentTypePrefix",
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
      return prefixService.createDocumentTypePrefix(tx, owner.callerIdentity, audit, {
        documentType: "expense",
        prefix: "exp_",
      });
    });

    await assertAuditLogged(adminPool, tenantId, "create", "document_type_prefix", result.data!.id);
  });
});

// ─────────────────────────────────────────────────────────────
// Server actions RBAC tests
// ─────────────────────────────────────────────────────────────
describe("document-type prefix actions RBAC", () => {
  it("owner can create via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await createAction({ documentType: "tax", prefix: "tax_" });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.id).toBeDefined();
  });

  it("owner can read via action (triggers seed-on-first-access)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await getAction({});
    expect(result?.serverError).toBeUndefined();
    // Should have 5 default prefixes from seed-on-first-access
    expect(result?.data?.data?.length).toBe(5);
  });

  it("member cannot create via action (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await createAction({ documentType: "tax", prefix: "tax_" });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated cannot read (UNAUTHORIZED)", async () => {
    mockHeaders = new Headers();
    const result = await getAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
