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
import * as basService from "@/modules/settings/bas-preferences";

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
  activateBasCategoriesAction,
  getBasCategoriesAction,
  getTenantBasPreferencesAction,
} from "@/modules/settings/bas-preferences.actions";

// ─────────────────────────────────────────────────────────────
// bas_categories reference table tests
// ─────────────────────────────────────────────────────────────
describe("bas_categories reference table", () => {
  it("has ~472 seeded entries", async () => {
    const categories = await basService.getBasCategories(prisma);
    expect(categories.length).toBeGreaterThanOrEqual(460);
    expect(categories.length).toBeLessThanOrEqual(500);
  });

  it("spot-check: code 501 = Lokalhyra", async () => {
    const categories = await basService.getBasCategories(prisma);
    const c501 = categories.find((c) => c.code === "501");
    expect(c501).toBeDefined();
    expect(c501?.name).toBe("Lokalhyra");
    expect(c501?.nameEn).toBe("Rent");
    expect(c501?.classNum).toBe(5);
  });

  it("spot-check: code 899 = Resultat", async () => {
    const categories = await basService.getBasCategories(prisma);
    const c899 = categories.find((c) => c.code === "899");
    expect(c899).toBeDefined();
    expect(c899?.name).toBe("Resultat");
    expect(c899?.nameEn).toBe("Result");
    expect(c899?.isCommon).toBe(true);
  });

  it("categories are ordered by classNum then code", async () => {
    const categories = await basService.getBasCategories(prisma);
    for (let i = 1; i < categories.length; i++) {
      const prev = categories[i - 1];
      const curr = categories[i];
      if (prev.classNum === curr.classNum) {
        expect(prev.code <= curr.code).toBe(true);
      } else {
        expect(prev.classNum < curr.classNum).toBe(true);
      }
    }
  });

  it("immutability: INSERT blocked for app role", async () => {
    try {
      await appPool.query(
        "INSERT INTO bas_categories (code, name, class_name, class_num) VALUES ('999', 'Test', 'TEST', 9)",
      );
      // If no error, the RULE silently drops — that's acceptable
    } catch {
      // Permission denied is also acceptable
    }
    // Verify no new row was created
    const result = await appPool.query("SELECT COUNT(*) FROM bas_categories WHERE code = '999'");
    expect(Number.parseInt(result.rows[0].count, 10)).toBe(0);
  });

  it("immutability: UPDATE blocked (silently dropped by RULE)", async () => {
    // Get original name
    const before = await adminPool.query("SELECT name FROM bas_categories WHERE code = '501'");
    const originalName = before.rows[0].name;

    // Attempt update via admin (bypasses GRANT but not RULE)
    await adminPool.query("UPDATE bas_categories SET name = 'HACKED' WHERE code = '501'");

    // Verify name unchanged (RULE silently drops)
    const after = await adminPool.query("SELECT name FROM bas_categories WHERE code = '501'");
    expect(after.rows[0].name).toBe(originalName);
  });

  it("immutability: DELETE blocked (silently dropped by RULE)", async () => {
    const before = await adminPool.query("SELECT COUNT(*) FROM bas_categories");
    const beforeCount = Number.parseInt(before.rows[0].count, 10);

    await adminPool.query("DELETE FROM bas_categories WHERE code = '501'");

    const after = await adminPool.query("SELECT COUNT(*) FROM bas_categories");
    expect(Number.parseInt(after.rows[0].count, 10)).toBe(beforeCount);
  });
});

// ─────────────────────────────────────────────────────────────
// tenant_bas_preferences service tests
// ─────────────────────────────────────────────────────────────
describe("bas preferences service", () => {
  it("bulk activation: activate 32 codes", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    const codes = [
      "126",
      "153",
      "193",
      "194",
      "197",
      "208",
      "244",
      "261",
      "262",
      "264",
      "300",
      "361",
      "399",
      "501",
      "512",
      "540",
      "541",
      "580",
      "591",
      "620",
      "631",
      "640",
      "650",
      "690",
      "722",
      "731",
      "757",
      "769",
      "836",
      "841",
      "891",
      "899",
    ];

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return basService.activateBasCategories(tx, owner.callerIdentity, audit, codes);
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.activated).toBe(32);

    // Verify all created
    const prefs = await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.getTenantBasPreferences(tx, owner.callerIdentity);
    });
    expect(prefs.data?.length).toBe(32);
  });

  it("deactivation: delete preference and audit captures old state", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    // Activate first
    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return basService.activateBasCategories(tx, owner.callerIdentity, audit, ["501"]);
    });

    // Deactivate
    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return basService.deactivateBasCategory(tx, owner.callerIdentity, audit, "501");
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.deactivated).toBe(true);

    // Verify audit log has delete action with oldData
    await assertAuditLogged(
      adminPool,
      owner.callerIdentity.tenantId,
      "delete",
      "tenant_bas_preference",
      "501",
    );
  });

  it("duplicate activation: same code twice returns DUPLICATE_ENTRY", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    // First activation
    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["501"]);
    });

    // Second activation — same code
    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["501"]);
      },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("DUPLICATE_ENTRY");
  });

  it("activation with invalid codes returns VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["XXXX"]);
      },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("update: isFavorite toggle", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["501"]);
    });

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        const audit = createRealAuditLogger(tx, owner.callerIdentity);
        return basService.updateBasPreference(tx, owner.callerIdentity, audit, "501", {
          isFavorite: true,
        });
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.updated).toBe(true);
  });

  it("update: shortCode change", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["501"]);
    });

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return basService.updateBasPreference(tx, owner.callerIdentity, noopAudit, "501", {
          shortCode: "Lokal",
        });
      },
    );

    expect(result.error).toBeUndefined();

    // Verify persisted
    const prefs = await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.getTenantBasPreferences(tx, owner.callerIdentity);
    });
    const p501 = prefs.data?.find((p) => p.basCode === "501");
    expect(p501?.shortCode).toBe("Lokal");
  });

  it("update: translations with valid JSONB shape", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["501"]);
    });

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return basService.updateBasPreference(tx, owner.callerIdentity, noopAudit, "501", {
          translations: { en: "Rent", sv: "Hyra", fr: "Loyer" },
        });
      },
    );

    expect(result.error).toBeUndefined();
  });

  it("update: invalid translations shape returns VALIDATION_ERROR", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["501"]);
    });

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return basService.updateBasPreference(tx, owner.callerIdentity, noopAudit, "501", {
          // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
          translations: { invalid: 123 } as any,
        });
      },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("update: non-existent preference returns NOT_FOUND", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    const result = await withTenantTransaction(
      prisma,
      owner.callerIdentity.tenantId,
      async (tx) => {
        return basService.updateBasPreference(tx, owner.callerIdentity, noopAudit, "501", {
          isFavorite: true,
        });
      },
    );

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

// ─────────────────────────────────────────────────────────────
// RLS isolation tests
// ─────────────────────────────────────────────────────────────
describe("RLS isolation", () => {
  it("tenantB cannot see tenantA's preferences", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");

    // Activate for tenant A
    await withTenantTransaction(prisma, ownerA.callerIdentity.tenantId, async (tx) => {
      return basService.activateBasCategories(tx, ownerA.callerIdentity, noopAudit, ["501", "620"]);
    });

    await assertRlsIsolation(
      prisma,
      "tenantBasPreference",
      ownerA.callerIdentity.tenantId,
      ownerB.callerIdentity.tenantId,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Audit logging tests
// ─────────────────────────────────────────────────────────────
describe("audit logging", () => {
  it("activation creates audit log entries", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return basService.activateBasCategories(tx, owner.callerIdentity, audit, ["501"]);
    });

    await assertAuditLogged(
      adminPool,
      owner.callerIdentity.tenantId,
      "create",
      "tenant_bas_preference",
      "501",
    );
  });

  it("update creates audit log entry with oldData and newData", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["501"]);
    });

    await withTenantTransaction(prisma, owner.callerIdentity.tenantId, async (tx) => {
      const audit = createRealAuditLogger(tx, owner.callerIdentity);
      return basService.updateBasPreference(tx, owner.callerIdentity, audit, "501", {
        isFavorite: true,
      });
    });

    await assertAuditLogged(
      adminPool,
      owner.callerIdentity.tenantId,
      "update",
      "tenant_bas_preference",
      "501",
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Full CRUD cycle test
// ─────────────────────────────────────────────────────────────
describe("full CRUD cycle", () => {
  it("activate → read → update → deactivate", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const tenantId = owner.callerIdentity.tenantId;

    // Activate
    const activateResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return basService.activateBasCategories(tx, owner.callerIdentity, noopAudit, ["620"]);
    });
    expect(activateResult.data?.activated).toBe(1);

    // Read
    const readResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return basService.getTenantBasPreferences(tx, owner.callerIdentity);
    });
    expect(readResult.data?.length).toBe(1);
    expect(readResult.data?.[0].basCode).toBe("620");

    // Update
    const updateResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return basService.updateBasPreference(tx, owner.callerIdentity, noopAudit, "620", {
        isFavorite: true,
        shortCode: "Tele",
      });
    });
    expect(updateResult.data?.updated).toBe(true);

    // Deactivate
    const deactivateResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return basService.deactivateBasCategory(tx, owner.callerIdentity, noopAudit, "620");
    });
    expect(deactivateResult.data?.deactivated).toBe(true);

    // Verify gone
    const afterResult = await withTenantTransaction(prisma, tenantId, async (tx) => {
      return basService.getTenantBasPreferences(tx, owner.callerIdentity);
    });
    expect(afterResult.data?.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Server actions tests
// ─────────────────────────────────────────────────────────────
describe("bas preferences actions", () => {
  it("any auth user can read bas categories via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await getBasCategoriesAction({});
    expect(result?.serverError).toBeUndefined();
    expect(result?.data?.data?.length).toBeGreaterThan(400);
  });

  it("owner can activate via action", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    mockHeaders = owner.headers;

    const result = await activateBasCategoriesAction({ codes: ["501"] });
    expect(result?.serverError).toBeUndefined();
  });

  it("member cannot activate via action (FORBIDDEN)", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const member = await createAuthenticatedContext(auth, "member", {
      headers: owner.headers,
      orgId: owner.callerIdentity.tenantId,
    });
    mockHeaders = member.headers;

    const result = await activateBasCategoriesAction({ codes: ["501"] });
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated cannot read preferences (UNAUTHORIZED)", async () => {
    mockHeaders = new Headers();
    const result = await getTenantBasPreferencesAction({});
    expect(result?.serverError).toBeDefined();
    expect(result?.serverError).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
