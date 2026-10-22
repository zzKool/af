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
import * as bankService from "@/modules/banking/bank-accounts";

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
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

let adminPool: Pool;

/** Helper: get the seeded Nordea format ID */
async function getNordeaFormatId(): Promise<string> {
  const result = await adminPool.query(
    `SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`,
  );
  return result.rows[0].id;
}

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
  createBankAccountAction as createAction,
  getBankAccountsAction as getAccountsAction,
  getBankFormatsAction as getFormatsAction,
} from "@/modules/banking/bank-accounts.actions";

// ─────────────────────────────────────────────────────────────
// Bank formats (app-level) tests
// ─────────────────────────────────────────────────────────────
describe("bank formats (app-level)", () => {
  it("getBankFormats: returns seeded Nordea format with all fields", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const formats = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.getBankFormats(tx);
    });

    expect(formats.length).toBeGreaterThanOrEqual(1);
    const nordea = formats.find((f) => f.name === "Nordea CSV (Sweden)");
    expect(nordea).toBeDefined();
    expect(nordea?.bankName).toBe("Nordea");
    expect(nordea?.delimiter).toBe(";");
    expect(nordea?.decimalSeparator).toBe(",");
    expect(nordea?.dateFormat).toBe("YYYY/MM/DD");
    expect(nordea?.encoding).toBe("ISO-8859-1");
    expect(nordea?.columnMapping).toBeDefined();

    // Verify column mapping structure
    const mapping = nordea?.columnMapping as {
      columns: { index: number; field: string; label: string }[];
      hasHeader: boolean;
      trailingDelimiter: boolean;
    };
    expect(mapping.columns).toHaveLength(10);
    expect(mapping.hasHeader).toBe(true);
    expect(mapping.trailingDelimiter).toBe(true);
    expect(mapping.columns[0].field).toBe("date");
    expect(mapping.columns[1].field).toBe("amount");
  });

  it("app-level data visibility: both tenantA and tenantB can read bank_formats", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    const formatsA = await withTenantTransaction(
      prisma,
      ownerA.callerIdentity.tenantId,
      async (tx) => {
        return bankService.getBankFormats(tx);
      },
    );

    const formatsB = await withTenantTransaction(
      prisma,
      ownerB.callerIdentity.tenantId,
      async (tx) => {
        return bankService.getBankFormats(tx);
      },
    );

    // Both tenants see the same formats
    expect(formatsA.length).toBeGreaterThan(0);
    expect(formatsA.length).toBe(formatsB.length);
    expect(formatsA[0].id).toBe(formatsB[0].id);
  });
});

// ─────────────────────────────────────────────────────────────
// Bank accounts service tests
// ─────────────────────────────────────────────────────────────
describe("bank accounts service", () => {
  it("create: add bank account with Nordea format", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return bankService.createBankAccount(tx, owner.callerIdentity, audit, {
        accountAlias: "Plusgiro SEK",
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();

    // Verify stored with format relation
    const accounts = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.getBankAccounts(tx, owner.callerIdentity);
    });
    expect(accounts.data?.length).toBe(1);
    expect(accounts.data?.[0].accountAlias).toBe("Plusgiro SEK");
    expect(accounts.data?.[0].accountNumber).toBe("211 53 13-5");
    expect(accounts.data?.[0].currency).toBe("SEK");
    expect(accounts.data?.[0].bankFormat.bankName).toBe("Nordea");
  });

  it("create multiple: same account number with different currencies", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountAlias: "Plusgiro SEK",
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountAlias: "Plusgiro CHF",
        accountNumber: "211 53 13-5",
        currency: "CHF",
        bankFormatId: formatId,
      });
    });

    const accounts = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.getBankAccounts(tx, owner.callerIdentity);
    });
    expect(accounts.data?.length).toBe(2);
    // Both have format relation included
    expect(accounts.data?.[0].bankFormat).toBeDefined();
    expect(accounts.data?.[1].bankFormat).toBeDefined();
  });

  it("duplicate prevention: same accountNumber + currency → DUPLICATE_ENTRY", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("update: change accountAlias, verify audit captures oldData/newData", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountAlias: "Old Alias",
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return bankService.updateBankAccount(tx, owner.callerIdentity, audit, id, {
        accountAlias: "New Alias",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);

    await assertAuditLogged(adminPool, tenantId, "update", "bank_account", id);
  });

  it("update bankFormatId: change format reference, verify FK integrity", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });
    const id = created.data!.id;

    // Update to same format (only one exists) — should succeed
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.updateBankAccount(tx, owner.callerIdentity, noopAudit, id, {
        bankFormatId: formatId,
      });
    });
    expect(result.error).toBeUndefined();
  });

  it("update accountNumber+currency collision → DUPLICATE_ENTRY", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });

    const created2 = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "1195 32 74218",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });
    const id2 = created2.data!.id;

    // Try to update second account to match first
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.updateBankAccount(tx, owner.callerIdentity, noopAudit, id2, {
        accountNumber: "211 53 13-5",
      });
    });

    expect(result.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("delete: remove account, verify audit captures old state", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return bankService.deleteBankAccount(tx, owner.callerIdentity, audit, id);
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.deleted).toBe(true);

    await assertAuditLogged(adminPool, tenantId, "delete", "bank_account", id);

    // Verify gone
    const accounts = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.getBankAccounts(tx, owner.callerIdentity);
    });
    expect(accounts.data?.length).toBe(0);
  });

  it("currency validation: reject invalid currency", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "GBP",
        bankFormatId: formatId,
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("Invalid currency");
  });

  it("bankFormatId validation: reject non-existent format ID", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: "00000000-0000-0000-0000-000000000000",
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("Bank format not found");
  });

  it("update bankFormatId validation: reject non-existent format ID", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.updateBankAccount(tx, owner.callerIdentity, noopAudit, id, {
        bankFormatId: "00000000-0000-0000-0000-000000000000",
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("Bank format not found");
  });
});

// ─────────────────────────────────────────────────────────────
// Full CRUD cycle test
// ─────────────────────────────────────────────────────────────
describe("full CRUD cycle", () => {
  it("create → read → update → delete via assertCrudOperations", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    await assertCrudOperations({
      create: async () => {
        const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
          return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
            accountNumber: "211 53 13-5",
            currency: "SEK",
            bankFormatId: formatId,
          });
        });
        return { id: result.data!.id };
      },
      read: async (id) => {
        return withTenantTransaction(prisma, tenantId, async (tx) => {
          return tx.bankAccount.findUnique({ where: { id } });
        });
      },
      update: async (id) => {
        const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
          return bankService.updateBankAccount(tx, owner.callerIdentity, noopAudit, id, {
            accountAlias: "Updated Alias",
          });
        });
        return result.data;
      },
      remove: async (id) => {
        await withTenantTransaction(prisma, tenantId, async (tx) => {
          return bankService.deleteBankAccount(tx, owner.callerIdentity, noopAudit, id);
        });
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────
// RLS isolation tests
// ─────────────────────────────────────────────────────────────
describe("RLS isolation", () => {
  it("tenantB cannot see tenantA's bank accounts", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");
    const formatId = await getNordeaFormatId();

    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return bankService.createBankAccount(tx, ownerA.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });

    await assertRlsIsolation(
      prisma,
      "bankAccount",
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
    const formatId = await getNordeaFormatId();

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return bankService.createBankAccount(tx, owner.callerIdentity, audit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });

    await assertAuditLogged(adminPool, tenantId, "create", "bank_account", result.data?.id);
  });

  it("update creates audit log with oldData and newData", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return bankService.updateBankAccount(tx, owner.callerIdentity, audit, id, {
        accountAlias: "Updated Name",
      });
    });

    await assertAuditLogged(adminPool, tenantId, "update", "bank_account", id);
  });

  it("delete creates audit log with oldData", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    const formatId = await getNordeaFormatId();

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return bankService.createBankAccount(tx, owner.callerIdentity, noopAudit, {
        accountNumber: "211 53 13-5",
        currency: "SEK",
        bankFormatId: formatId,
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return bankService.deleteBankAccount(tx, owner.callerIdentity, audit, id);
    });

    await assertAuditLogged(adminPool, tenantId, "delete", "bank_account", id);
  });
});

// ─────────────────────────────────────────────────────────────
// Server actions tests
// ─────────────────────────────────────────────────────────────
describe("bank account actions", () => {
  it("getBankFormats: authedAction allows any authenticated role", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await getFormatsAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.length).toBeGreaterThanOrEqual(1);
  });

  it("getBankFormats: member can also read formats (authedAction)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await getFormatsAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.length).toBeGreaterThanOrEqual(1);
  });

  it("owner can create bank account via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;
    const formatId = await getNordeaFormatId();

    const result = await createAction({
      accountNumber: "211 53 13-5",
      currency: "SEK",
      bankFormatId: formatId,
    });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.id).toBeDefined();
  });

  it("owner can read bank accounts via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;
    const formatId = await getNordeaFormatId();

    await createAction({
      accountNumber: "211 53 13-5",
      currency: "SEK",
      bankFormatId: formatId,
    });

    const result = await getAccountsAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.length).toBe(1);
  });

  it("member cannot create bank account via action (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;
    const formatId = await getNordeaFormatId();

    const result = await createAction({
      accountNumber: "211 53 13-5",
      currency: "SEK",
      bankFormatId: formatId,
    });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated cannot read bank accounts (UNAUTHORIZED)", async () => {
    mockHeaders = new Headers();
    const result = await getAccountsAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
