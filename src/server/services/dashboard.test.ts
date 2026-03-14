import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionClient } from "@/server/db/tenant-client";
import type { CallerIdentity } from "@/types/caller-identity";
import { getDashboardData } from "./dashboard";

const mockCaller: CallerIdentity = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "owner",
  source: "web",
};

function createMockPrisma(overrides: {
  userName?: string | null;
  sessions?: { createdAt: Date }[];
}) {
  return {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          overrides.userName !== undefined ? { name: overrides.userName } : { name: "Test User" },
        ),
    },
    session: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          overrides.sessions ?? [
            { createdAt: new Date("2026-03-10T10:00:00Z") },
            { createdAt: new Date("2026-03-09T08:00:00Z") },
          ],
        ),
    },
  } as unknown as PrismaClient;
}

function createMockTx(overrides: {
  companyName?: string | null;
  throwOnTenant?: boolean;
  partnerCount?: number;
  activeContractCount?: number;
}) {
  return {
    tenant: {
      findUnique: overrides.throwOnTenant
        ? vi.fn().mockRejectedValue(new Error("DB error"))
        : vi
            .fn()
            .mockResolvedValue(
              overrides.companyName !== undefined
                ? { name: overrides.companyName }
                : { name: "Acme AB" },
            ),
    },
    partner: {
      count: vi.fn().mockResolvedValue(overrides.partnerCount ?? 0),
    },
    contract: {
      count: vi.fn().mockResolvedValue(overrides.activeContractCount ?? 0),
    },
  } as unknown as TransactionClient;
}

describe("getDashboardData", () => {
  it("returns full dashboard data on happy path", async () => {
    const prisma = createMockPrisma({});
    const tx = createMockTx({ partnerCount: 3, activeContractCount: 5 });

    const result = await getDashboardData(prisma, tx, mockCaller);

    expect(result).toEqual({
      userName: "Test User",
      companyName: "Acme AB",
      lastLoginAt: "2026-03-09T08:00:00.000Z",
      role: "owner",
      partnerCount: 3,
      activeContractCount: 5,
    });
  });

  it("returns null lastLoginAt on first login (only one session)", async () => {
    const prisma = createMockPrisma({
      sessions: [{ createdAt: new Date("2026-03-10T10:00:00Z") }],
    });
    const tx = createMockTx({});

    const result = await getDashboardData(prisma, tx, mockCaller);

    expect(result.lastLoginAt).toBeNull();
  });

  it("returns null companyName when tenant query fails", async () => {
    const prisma = createMockPrisma({});
    const tx = createMockTx({ throwOnTenant: true });

    const result = await getDashboardData(prisma, tx, mockCaller);

    expect(result.companyName).toBeNull();
  });

  it("returns null companyName when tenant has no name", async () => {
    const prisma = createMockPrisma({});
    const tx = createMockTx({ companyName: null });

    const result = await getDashboardData(prisma, tx, mockCaller);

    expect(result.companyName).toBeNull();
  });

  it("returns 'User' fallback when user name is null", async () => {
    const prisma = createMockPrisma({ userName: null });
    const tx = createMockTx({});

    const result = await getDashboardData(prisma, tx, mockCaller);

    expect(result.userName).toBe("User");
  });

  it("returns correct role from caller identity", async () => {
    const prisma = createMockPrisma({});
    const tx = createMockTx({});

    const result = await getDashboardData(prisma, tx, {
      ...mockCaller,
      role: "accountant",
    });

    expect(result.role).toBe("accountant");
  });

  it("returns partner and contract counts", async () => {
    const prisma = createMockPrisma({});
    const tx = createMockTx({ partnerCount: 7, activeContractCount: 12 });

    const result = await getDashboardData(prisma, tx, mockCaller);

    expect(result.partnerCount).toBe(7);
    expect(result.activeContractCount).toBe(12);
    expect(tx.partner.count).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(tx.contract.count).toHaveBeenCalledWith({ where: { isActive: true } });
  });

  it("returns zero counts when no partners or contracts exist", async () => {
    const prisma = createMockPrisma({});
    const tx = createMockTx({ partnerCount: 0, activeContractCount: 0 });

    const result = await getDashboardData(prisma, tx, mockCaller);

    expect(result.partnerCount).toBe(0);
    expect(result.activeContractCount).toBe(0);
  });
});
