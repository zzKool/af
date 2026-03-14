import { describe, expect, it, vi } from "vitest";
import { createSystemCaller } from "./context";

// Mock dependencies for withInngestContext
vi.mock("@/server/db/client", () => ({
  prisma: {},
}));

const mockWithTenantTransaction = vi.fn();
vi.mock("@/server/db/tenant-client", () => ({
  withTenantTransaction: (...args: unknown[]) => mockWithTenantTransaction(...args),
}));

const mockCreateAuditEntry = vi.fn();
vi.mock("@/server/services/audit", () => ({
  createAuditEntry: (...args: unknown[]) => mockCreateAuditEntry(...args),
}));

// Import after mocks
const { withInngestContext } = await import("./context");

describe("createSystemCaller", () => {
  it("returns CallerIdentity with source 'system' and role 'owner'", () => {
    const caller = createSystemCaller("tenant-123", "user-456");

    expect(caller).toEqual({
      userId: "user-456",
      tenantId: "tenant-123",
      role: "owner",
      source: "system",
    });
  });

  it("preserves the original userId (not a system account)", () => {
    const caller = createSystemCaller("t1", "real-user-id");
    expect(caller.userId).toBe("real-user-id");
  });
});

describe("withInngestContext", () => {
  it("calls withTenantTransaction with prisma and tenantId", async () => {
    const fakeTx = { partner: { count: vi.fn() } };
    mockWithTenantTransaction.mockImplementation(async (_prisma, _tenantId, cb) => cb(fakeTx));

    await withInngestContext("tenant-1", "user-1", async () => "result");

    expect(mockWithTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), // prisma
      "tenant-1",
      expect.any(Function),
    );
  });

  it("passes tx, caller, and audit to callback", async () => {
    const fakeTx = {};
    mockWithTenantTransaction.mockImplementation(async (_prisma, _tenantId, cb) => cb(fakeTx));

    let receivedTx: unknown;
    let receivedCaller: unknown;
    let receivedAudit: unknown;

    await withInngestContext("tenant-1", "user-1", async (tx, caller, audit) => {
      receivedTx = tx;
      receivedCaller = caller;
      receivedAudit = audit;
    });

    expect(receivedTx).toBe(fakeTx);
    expect(receivedCaller).toEqual({
      userId: "user-1",
      tenantId: "tenant-1",
      role: "owner",
      source: "system",
    });
    expect(receivedAudit).toHaveProperty("log");
    expect(typeof (receivedAudit as { log: unknown }).log).toBe("function");
  });

  it("audit.log delegates to createAuditEntry with correct args", async () => {
    const fakeTx = {};
    mockWithTenantTransaction.mockImplementation(async (_prisma, _tenantId, cb) => cb(fakeTx));
    mockCreateAuditEntry.mockResolvedValue(undefined);

    await withInngestContext("tenant-1", "user-1", async (_tx, _caller, audit) => {
      await audit.log({
        action: "create",
        entityType: "Document",
        entityId: "doc-1",
        oldData: null,
        newData: { name: "test.pdf" },
      });
    });

    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      fakeTx,
      { userId: "user-1", tenantId: "tenant-1", role: "owner", source: "system" },
      {
        action: "create",
        entityType: "Document",
        entityId: "doc-1",
        oldData: null,
        newData: { name: "test.pdf" },
      },
    );
  });

  it("returns the callback result", async () => {
    const fakeTx = {};
    mockWithTenantTransaction.mockImplementation(async (_prisma, _tenantId, cb) => cb(fakeTx));

    const result = await withInngestContext("tenant-1", "user-1", async () => ({
      processed: true,
      count: 42,
    }));

    expect(result).toEqual({ processed: true, count: 42 });
  });
});
