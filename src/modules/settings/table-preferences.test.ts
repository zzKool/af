import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { auth } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import * as tablePrefsService from "@/modules/settings/table-preferences";

// Mock next/headers
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeaders),
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await adminPool.end();
});

describe("table-preferences service", () => {
  describe("getTablePreference", () => {
    it("returns null when no preference exists", async () => {
      const ctx = await createAuthenticatedContext(auth, "owner");

      const result = await tablePrefsService.getTablePreference(
        prisma,
        ctx.callerIdentity,
        "documents",
      );

      expect(result.error).toBeUndefined();
      expect(result.data).toBeNull();
    });

    it("returns preference when one exists", async () => {
      const ctx = await createAuthenticatedContext(auth, "owner");

      // Create preference first
      await tablePrefsService.upsertTablePreference(prisma, ctx.callerIdentity, "documents", {
        filters: { status: ["extracted"] },
        sort: { field: "createdAt", direction: "desc" },
      });

      const result = await tablePrefsService.getTablePreference(
        prisma,
        ctx.callerIdentity,
        "documents",
      );

      expect(result.error).toBeUndefined();
      expect(result.data).not.toBeNull();
      expect(result.data?.tableKey).toBe("documents");
      expect(result.data?.preferences).toMatchObject({
        filters: { status: ["extracted"] },
      });
    });
  });

  describe("upsertTablePreference", () => {
    it("creates new preference when none exists", async () => {
      const ctx = await createAuthenticatedContext(auth, "owner");

      const result = await tablePrefsService.upsertTablePreference(
        prisma,
        ctx.callerIdentity,
        "documents",
        {
          filters: { status: ["uploaded"] },
          pageSize: 50,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.data?.tableKey).toBe("documents");
      expect(result.data?.preferences).toMatchObject({ pageSize: 50 });
    });

    it("updates existing preference on second call", async () => {
      const ctx = await createAuthenticatedContext(auth, "owner");

      // First upsert
      await tablePrefsService.upsertTablePreference(prisma, ctx.callerIdentity, "documents", {
        pageSize: 25,
      });

      // Second upsert — overwrites
      const result = await tablePrefsService.upsertTablePreference(
        prisma,
        ctx.callerIdentity,
        "documents",
        { pageSize: 50 },
      );

      expect(result.error).toBeUndefined();
      expect(result.data?.preferences).toMatchObject({ pageSize: 50 });
    });

    it("different tableKeys do not conflict", async () => {
      const ctx = await createAuthenticatedContext(auth, "owner");

      await tablePrefsService.upsertTablePreference(prisma, ctx.callerIdentity, "documents", {
        filters: { status: ["extracted"] },
      });
      await tablePrefsService.upsertTablePreference(prisma, ctx.callerIdentity, "journal", {
        filters: { type: ["expense"] },
      });

      const [docsResult, journalResult] = await Promise.all([
        tablePrefsService.getTablePreference(prisma, ctx.callerIdentity, "documents"),
        tablePrefsService.getTablePreference(prisma, ctx.callerIdentity, "journal"),
      ]);

      expect(docsResult.data?.preferences).toMatchObject({ filters: { status: ["extracted"] } });
      expect(journalResult.data?.preferences).toMatchObject({ filters: { type: ["expense"] } });
    });
  });
});
