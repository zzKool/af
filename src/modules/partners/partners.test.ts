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
import { assertAuditLogged, assertRlsIsolation } from "@/kernel/test-utils/config-crud-helpers";
import * as partnerService from "@/modules/partners/partners";
import * as basService from "@/modules/settings";

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

/** Helper: activate BAS code "501" for a tenant to use in FK validation tests */
async function activateBasForTenant(
  tenantId: string,
  caller: CallerIdentity,
  code = "501",
): Promise<void> {
  await withTenantTransaction(prisma, tenantId, async (tx) => {
    await basService.activateBasCategories(tx, caller, noopAudit, [code]);
  });
}

// ─────────────────────────────────────────────────────────────
// Partner service CRUD tests
// ─────────────────────────────────────────────────────────────
describe("partner service", () => {
  it("create: partner with all fields", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await activateBasForTenant(tenantId, owner.callerIdentity);

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.createPartner(tx, owner.callerIdentity, audit, {
        name: "Acme AB",
        orgNumber: "556677-8899",
        vatNumber: "SE5566778899",
        types: ["client", "vendor"],
        defaultCurrency: "SEK",
        defaultLanguage: "sv-SE",
        defaultBasCategoryCode: "501",
        externalIdentifiers: [{ label: "Supplier Number", value: "SUP-44821" }],
        email: "info@acme.se",
        phone: "+46701234567",
        address: {
          street: "Storgatan 1",
          city: "Stockholm",
          postalCode: "111 22",
          country: "SE",
        },
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();

    // Verify stored
    const partners = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartners(tx);
    });
    expect(partners.data?.length).toBe(1);
    expect(partners.data?.[0].name).toBe("Acme AB");
    expect(partners.data?.[0].types).toEqual(["client", "vendor"]);
    expect(partners.data?.[0].defaultCurrency).toBe("SEK");
    expect(partners.data?.[0].defaultBasCategoryCode).toBe("501");
  });

  it("JSON columns round-trip: identifiers and address, undefined address keys dropped", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, (tx) =>
      partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Json AB",
        types: ["vendor"],
        externalIdentifiers: [{ label: "Supplier Number", value: "SUP-1" }],
        address: { street: "Storgatan 1", city: undefined, country: "SE" },
      }),
    );
    const id = created.data!.id;
    const read = () =>
      withTenantTransaction(prisma, tenantId, (tx) => partnerService.getPartner(tx, id));

    const first = (await read()).data!;
    expect(first.externalIdentifiers).toEqual([{ label: "Supplier Number", value: "SUP-1" }]);
    expect(first.address).toEqual({ street: "Storgatan 1", country: "SE" });
    expect(Object.keys(first.address ?? {})).not.toContain("city");

    await withTenantTransaction(prisma, tenantId, (tx) =>
      partnerService.updatePartner(tx, owner.callerIdentity, noopAudit, id, {
        externalIdentifiers: [
          { label: "Supplier Number", value: "SUP-2" },
          { label: "IBAN", value: "SE00" },
        ],
      }),
    );
    const second = (await read()).data!;
    expect(second.externalIdentifiers).toEqual([
      { label: "Supplier Number", value: "SUP-2" },
      { label: "IBAN", value: "SE00" },
    ]);
    expect(second.address).toEqual({ street: "Storgatan 1", country: "SE" }); // not in the update → kept
  });

  it("create: partner with minimum fields (name + types)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Minimal Partner",
        types: ["client"],
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();

    const fetched = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartner(tx, result.data!.id);
    });
    expect(fetched.data?.name).toBe("Minimal Partner");
    expect(fetched.data?.types).toEqual(["client"]);
    expect(fetched.data?.orgNumber).toBeNull();
    expect(fetched.data?.defaultCurrency).toBeNull();
    expect(fetched.data?.isActive).toBe(true);
  });

  it("update: change partner name and currency", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Old Name",
        types: ["vendor"],
      });
    });
    const id = created.data!.id;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.updatePartner(tx, owner.callerIdentity, audit, id, {
        name: "New Name",
        defaultCurrency: "EUR",
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);

    const fetched = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartner(tx, id);
    });
    expect(fetched.data?.name).toBe("New Name");
    expect(fetched.data?.defaultCurrency).toBe("EUR");

    await assertAuditLogged(adminPool, tenantId, "update", "partner", id);
  });

  it("search: finds partners by name substring", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      await partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Acme AB",
        types: ["client"],
      });
      await partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Beta Corp",
        types: ["vendor"],
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.searchPartners(tx, "acme");
    });

    expect(result.data?.length).toBe(1);
    expect(result.data?.[0].name).toBe("Acme AB");
  });

  it("getPartners: search filters by name and org_number", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      await partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Acme AB",
        orgNumber: "556677-8899",
        types: ["client"],
      });
      await partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Beta Corp",
        orgNumber: "112233-4455",
        types: ["vendor"],
      });
    });

    // Search by org number
    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartners(tx, { search: "1122" });
    });
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0].name).toBe("Beta Corp");
  });
});

// ─────────────────────────────────────────────────────────────
// Validation tests
// ─────────────────────────────────────────────────────────────
describe("partner validation", () => {
  it("invalid BAS category ID → NOT_FOUND", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Test",
        types: ["client"],
        defaultBasCategoryCode: "999",
      });
    });

    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toContain("BAS category not found");
  });

  it("valid global BAS category but tenant has NOT activated it → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;
    // BAS code "501" exists globally but we don't activate it for this tenant

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Test",
        types: ["client"],
        defaultBasCategoryCode: "501",
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.error?.message).toContain("not activated");
  });

  it("another tenant's BAS category → VALIDATION_ERROR (not activated for this tenant)", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    // Activate "501" only for tenant A
    await activateBasForTenant(ownerA.callerIdentity.tenantId, ownerA.callerIdentity);

    // Tenant B tries to use "501" — not activated for tenant B
    const result = await withTenantTransaction(
      prisma,
      ownerB.callerIdentity.tenantId,
      async (tx) => {
        return partnerService.createPartner(tx, ownerB.callerIdentity, noopAudit, {
          name: "Test",
          types: ["client"],
          defaultBasCategoryCode: "501",
        });
      },
    );

    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("duplicate org_number in same tenant → DUPLICATE_ENTRY", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Partner A",
        orgNumber: "556677-8899",
        types: ["client"],
      });
    });

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Partner B",
        orgNumber: "556677-8899",
        types: ["vendor"],
      });
    });

    expect(result.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("same org_number in different tenant → success", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return partnerService.createPartner(tx, ownerA.callerIdentity, noopAudit, {
        name: "Partner A",
        orgNumber: "556677-8899",
        types: ["client"],
      });
    });

    const result = await withTenantTransaction(
      prisma,
      ownerB.callerIdentity.tenantId,
      async (tx) => {
        return partnerService.createPartner(tx, ownerB.callerIdentity, noopAudit, {
          name: "Partner B",
          orgNumber: "556677-8899",
          types: ["vendor"],
        });
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();
  });

  it("empty types array → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Test",
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        types: [] as any,
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("invalid types value → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Test",
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        types: ["contractor"] as any,
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("invalid external_identifiers shape → VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Test",
        types: ["client"],
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        externalIdentifiers: [{ label: "", value: "" }] as any,
      });
    });

    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────
// Soft-delete lifecycle tests
// ─────────────────────────────────────────────────────────────
describe("partner soft-delete lifecycle", () => {
  it("create → deactivate → excluded from default list → included with includeInactive → readable by getPartner → reactivate → visible again", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Create
    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Lifecycle Partner",
        types: ["client"],
      });
    });
    const id = created.data!.id;

    // Deactivate
    const deactResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.deactivatePartner(tx, owner.callerIdentity, audit, id);
    });
    expect(deactResult.data?.deactivated).toBe(true);

    // Excluded from default list
    const defaultList = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartners(tx);
    });
    expect(defaultList.data?.find((p) => p.id === id)).toBeUndefined();

    // Included with includeInactive
    const fullList = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartners(tx, { includeInactive: true });
    });
    expect(fullList.data?.find((p) => p.id === id)).toBeDefined();
    expect(fullList.data?.find((p) => p.id === id)?.isActive).toBe(false);

    // Still readable by getPartner (detail view)
    const detail = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartner(tx, id);
    });
    expect(detail.data?.id).toBe(id);
    expect(detail.data?.isActive).toBe(false);

    // Reactivate
    const reactResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.reactivatePartner(tx, owner.callerIdentity, audit, id);
    });
    expect(reactResult.data?.reactivated).toBe(true);

    // Visible in default list again
    const afterReactivate = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.getPartners(tx);
    });
    expect(afterReactivate.data?.find((p) => p.id === id)?.isActive).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// RLS isolation tests
// ─────────────────────────────────────────────────────────────
describe("partner RLS isolation", () => {
  it("tenantB cannot see tenantA's partners", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return partnerService.createPartner(tx, ownerA.callerIdentity, noopAudit, {
        name: "Tenant A Partner",
        types: ["client"],
      });
    });

    await assertRlsIsolation(
      prisma,
      "partner",
      ownerA.callerIdentity.tenantId,
      ownerB.callerIdentity.tenantId,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Audit logging tests
// ─────────────────────────────────────────────────────────────
describe("partner audit logging", () => {
  it("create generates audit log entry", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const result = await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.createPartner(tx, owner.callerIdentity, audit, {
        name: "Audit Test Partner",
        types: ["client"],
      });
    });

    await assertAuditLogged(adminPool, tenantId, "create", "partner", result.data!.id);
  });

  it("update creates audit log", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Before Update",
        types: ["client"],
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.updatePartner(tx, owner.callerIdentity, audit, id, {
        name: "After Update",
      });
    });

    await assertAuditLogged(adminPool, tenantId, "update", "partner", id);
  });

  it("deactivate creates audit log with action 'deactivate'", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Deactivation Target",
        types: ["client"],
      });
    });
    const id = created.data!.id;

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.deactivatePartner(tx, owner.callerIdentity, audit, id);
    });

    await assertAuditLogged(adminPool, tenantId, "deactivate", "partner", id);
  });

  it("reactivate creates audit log with action 'reactivate'", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    const created = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.createPartner(tx, owner.callerIdentity, noopAudit, {
        name: "Reactivation Target",
        types: ["client"],
      });
    });
    const id = created.data!.id;

    // Deactivate first
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      return partnerService.deactivatePartner(tx, owner.callerIdentity, noopAudit, id);
    });

    // Reactivate
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return partnerService.reactivatePartner(tx, owner.callerIdentity, audit, id);
    });

    await assertAuditLogged(adminPool, tenantId, "reactivate", "partner", id);
  });
});

// ─────────────────────────────────────────────────────────────
// Server Action RBAC tests
// ─────────────────────────────────────────────────────────────
// Import actions after mocks
import {
  createPartnerAction,
  deactivatePartnerAction,
  getPartnersAction,
  reactivatePartnerAction,
  searchPartnersAction,
  updatePartnerAction,
} from "@/modules/partners/partners.actions";

describe("partner actions RBAC", () => {
  it("owner can create via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await createPartnerAction({
      name: "Action Test Partner",
      types: ["client"],
    });
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.id).toBeDefined();
  });

  it("owner can read via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    await createPartnerAction({ name: "Readable Partner", types: ["client"] });

    const result = await getPartnersAction({});
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

    const result = await createPartnerAction({
      name: "Should Fail",
      types: ["client"],
    });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("member cannot read partners (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await getPartnersAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated cannot read partners (UNAUTHORIZED)", async () => {
    mockHeaders = new Headers();
    const result = await getPartnersAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("member cannot deactivate via action (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await deactivatePartnerAction({ id: "00000000-0000-0000-0000-000000000000" });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("member cannot search partners (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await searchPartnersAction({ query: "test" });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });
});
