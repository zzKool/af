// Contract rate history — specs/contracts/spec.md user stories 1–3 against the real database (RLS on).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestContract,
  createTestPartner,
} from "@/kernel/db/test-fixtures";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as rates from "./contract-rates";
import * as contractService from "./contracts";

const noopAudit: AuditLogger = { log: async () => {} };
function realAudit(tx: TransactionClient, caller: CallerIdentity): AuditLogger {
  return { log: async (params) => createAuditEntry(tx, caller, params) };
}

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));

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
  rates.setRateUsage(async () => 0);
});
afterAll(async () => {
  await adminPool.end();
});

/** A client partner + one contract (CHF, from 2025-01-01) for the caller's tenant. */
async function setup(caller: CallerIdentity) {
  const partner = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
    types: ["client"],
    defaultCurrency: "CHF",
  });
  const contract = await createTestContract(adminPool, caller.tenantId, caller.userId, partner.id, {
    startDate: "2025-01-01",
    currency: "CHF",
  });
  return { partnerId: partner.id, contractId: contract.id };
}

const add = (
  tx: TransactionClient,
  caller: CallerIdentity,
  contractId: string,
  validFrom: string,
  rate: string,
  validTo: string | null = null,
  audit: AuditLogger = noopAudit,
) => rates.createContractRate(tx, caller, audit, { contractId, validFrom, validTo, rate });

describe("US1 — record a rate change", () => {
  it("first rate: one open row, current, and the contract's currentRate follows (scenario 1)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);

    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const r = await add(
        tx,
        caller,
        contractId,
        "2025-01-01",
        "1000.00",
        null,
        realAudit(tx, caller),
      );
      expect(r.error).toBeUndefined();
      expect(r.data).toMatchObject({
        validFrom: "2025-01-01",
        validTo: null,
        rate: "1000.00",
        unit: "day",
      });

      const list = await rates.listContractRates(tx, contractId, "2025-06-01");
      expect(list.data).toHaveLength(1);
      expect(list.data?.[0].state).toBe("current");

      const contract = await contractService.getContract(tx, contractId, { today: "2025-06-01" });
      expect(contract.data?.currentRate).toEqual({ id: r.data?.id, rate: "1000.00", unit: "day" });
    });
    await assertAuditLogged(adminPool, caller.tenantId, "create", "contract_rate");
  });

  it("a new open rate closes the previous open rate on valid_from − 1, audited (scenario 2)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);

    const r2025 = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      add(tx, caller, contractId, "2025-01-01", "1000.00"),
    );
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const r2026 = await add(
        tx,
        caller,
        contractId,
        "2026-01-01",
        "1200.00",
        null,
        realAudit(tx, caller),
      );
      expect(r2026.error).toBeUndefined();

      const list = await rates.listContractRates(tx, contractId, "2026-10-20");
      expect(list.data?.map((r) => [r.validFrom, r.validTo, r.rate, r.state])).toEqual([
        ["2026-01-01", null, "1200.00", "current"],
        ["2025-01-01", "2025-12-31", "1000.00", "expired"],
      ]);
      // the same list seen from 2025 — states are relative to today, not stored
      const seenFrom2025 = await rates.listContractRates(tx, contractId, "2025-07-01");
      expect(seenFrom2025.data?.map((r) => r.state)).toEqual(["future", "current"]);
    });
    await assertAuditLogged(adminPool, caller.tenantId, "update", "contract_rate", r2025.data?.id);
    const closed = await adminPool.query(
      "SELECT new_data->>'reason' AS reason FROM audit_logs WHERE entity_type = 'contract_rate' AND action = 'update' AND entity_id = $1",
      [r2025.data?.id],
    );
    expect(closed.rows[0]?.reason).toBe("auto-close");
  });

  it("a future open rate closes the current one on the day before it starts (scenario 3)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      await add(tx, caller, contractId, "2025-01-01", "1000.00");
      await add(tx, caller, contractId, "2026-01-01", "1200.00");
      const r2027 = await add(tx, caller, contractId, "2027-01-01", "1300.00");
      expect(r2027.error).toBeUndefined();
      const list = await rates.listContractRates(tx, contractId, "2026-10-20");
      expect(list.data?.map((r) => [r.validTo, r.state])).toEqual([
        [null, "future"],
        ["2026-12-31", "current"],
        ["2025-12-31", "expired"],
      ]);
    });
  });

  it("overlapping and touching rates are refused with the existing interval (scenario 4)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      await add(tx, caller, contractId, "2025-01-01", "1000.00", "2025-11-30");
      await add(tx, caller, contractId, "2026-01-01", "1200.00");

      const inside = await add(tx, caller, contractId, "2025-06-01", "1100.00", "2025-08-31");
      expect(inside.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(inside.error?.message).toBe(
        "This rate overlaps an existing rate (2025-01-01 → 2025-11-30)",
      );
      expect(inside.error?.details).toMatchObject({ from: "2025-01-01", to: "2025-11-30" });

      // touching: sits in the December gap but ends on the day the 2026 rate starts (both inclusive)
      const touching = await add(tx, caller, contractId, "2025-12-15", "1150.00", "2026-01-01");
      expect(touching.error?.message).toContain("(2026-01-01 → open)");

      // an open rate dated before the existing open one cannot auto-close it (it starts later) → overlap
      const earlierOpen = await add(tx, caller, contractId, "2025-06-01", "1100.00");
      expect(earlierOpen.error?.code).toBe("BUSINESS_RULE_VIOLATION");

      // a closed rate never auto-closes: it must fit a gap
      const closedOverOpen = await add(
        tx,
        caller,
        contractId,
        "2026-06-01",
        "1250.00",
        "2026-06-30",
      );
      expect(closedOverOpen.error?.code).toBe("BUSINESS_RULE_VIOLATION");

      const list = await rates.listContractRates(tx, contractId, "2026-10-20");
      expect(list.data).toHaveLength(2);
    });
  });

  it("validation: valid_to before valid_from, rate ≤ 0, bad formats (scenario 5)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      expect(
        (await add(tx, caller, contractId, "2025-02-01", "1000.00", "2025-01-31")).error?.code,
      ).toBe("VALIDATION_ERROR");
      expect((await add(tx, caller, contractId, "2025-01-01", "0")).error?.code).toBe(
        "VALIDATION_ERROR",
      );
      expect((await add(tx, caller, contractId, "2025-01-01", "-5.00")).error?.code).toBe(
        "VALIDATION_ERROR",
      );
      expect((await add(tx, caller, contractId, "2025-01-01", "1000.123")).error?.code).toBe(
        "VALIDATION_ERROR",
      );
      expect((await add(tx, caller, contractId, "20250101", "1000.00")).error?.code).toBe(
        "VALIDATION_ERROR",
      );
      expect(
        (await add(tx, caller, crypto.randomUUID(), "2025-01-01", "1000.00")).error?.code,
      ).toBe("NOT_FOUND");
      expect((await rates.listContractRates(tx, contractId, "2025-01-01")).data).toEqual([]);
    });
  });
});

describe("US2 — rate lookup for a date (the invoices contract)", () => {
  it("rateFor is independent of today and of the contract's dates; bounds inclusive; gaps → null", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      await add(tx, caller, contractId, "2025-01-01", "1000.00", "2025-06-30");
      await add(tx, caller, contractId, "2025-09-01", "1100.00");
      await add(tx, caller, contractId, "2026-01-01", "1200.00");

      const at = async (d: string) => (await rates.rateFor(tx, contractId, d))?.rate ?? null;
      expect(await at("2024-12-31")).toBeNull();
      expect(await at("2025-01-01")).toBe("1000.00");
      expect(await at("2025-06-30")).toBe("1000.00");
      expect(await at("2025-07-15")).toBeNull(); // gap
      expect(await at("2025-09-01")).toBe("1100.00");
      expect(await at("2025-12-31")).toBe("1100.00");
      expect(await at("2026-01-01")).toBe("1200.00");
      expect(await at("2030-06-15")).toBe("1200.00"); // open end

      // deactivating the contract changes nothing for the lookup — a rate is a fact about a period
      await contractService.deactivateContract(tx, caller, noopAudit, contractId);
      expect(await at("2026-03-15")).toBe("1200.00");
    });
  });
});

describe("US3 — correct or remove a rate", () => {
  it("edit amount and dates in place, audited with before/after (scenario 1)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    const created = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      add(tx, caller, contractId, "2026-01-01", "1200.00"),
    );
    const id = created.data?.id as string;
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const r = await rates.updateContractRate(tx, caller, realAudit(tx, caller), {
        id,
        rate: "1250.00",
        validFrom: "2026-01-15",
        note: "negotiated",
      });
      expect(r.error).toBeUndefined();
      expect(r.data).toMatchObject({
        rate: "1250.00",
        validFrom: "2026-01-15",
        note: "negotiated",
      });
      expect((await rates.rateFor(tx, contractId, "2026-01-10"))?.id).toBeUndefined();
    });
    await assertAuditLogged(adminPool, caller.tenantId, "update", "contract_rate", id);
    const row = await adminPool.query(
      "SELECT old_data->>'rate' AS before, new_data->>'rate' AS after FROM audit_logs WHERE entity_id = $1 AND action = 'update'",
      [id],
    );
    expect(row.rows[0]).toEqual({ before: "1200.00", after: "1250.00" });
  });

  it("an edit that would overlap is refused; valid_to before valid_from is refused (scenario 2)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const r2025 = await add(tx, caller, contractId, "2025-01-01", "1000.00", "2025-12-31");
      await add(tx, caller, contractId, "2026-01-01", "1200.00");
      const id = r2025.data?.id as string;

      const moved = await rates.updateContractRate(tx, caller, noopAudit, {
        id,
        validTo: "2026-01-15",
      });
      expect(moved.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(moved.error?.message).toContain("(2026-01-01 → open)");

      const inverted = await rates.updateContractRate(tx, caller, noopAudit, {
        id,
        validFrom: "2025-12-31",
        validTo: "2025-01-01",
      });
      expect(inverted.error?.code).toBe("VALIDATION_ERROR");

      // shortening is fine
      const shortened = await rates.updateContractRate(tx, caller, noopAudit, {
        id,
        validTo: "2025-11-30",
      });
      expect(shortened.data?.validTo).toBe("2025-11-30");
      expect(
        (
          await rates.updateContractRate(tx, caller, noopAudit, {
            id: crypto.randomUUID(),
            note: "x",
          })
        ).error?.code,
      ).toBe("NOT_FOUND");
    });
  });

  it("delete an unused rate; a rate used by invoice lines is refused — close it instead (scenario 3)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    const created = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      add(tx, caller, contractId, "2026-01-01", "1200.00"),
    );
    const id = created.data?.id as string;

    rates.setRateUsage(async (_tx, rateId) => (rateId === id ? 3 : 0));
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const refused = await rates.deleteContractRate(tx, caller, noopAudit, id);
      expect(refused.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(refused.error?.message).toBe(
        "This rate is used on 3 invoice line(s) and cannot be deleted — close it instead",
      );
      expect(refused.error?.details).toEqual({ n: 3 });
    });

    rates.setRateUsage(async () => 0);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const ok = await rates.deleteContractRate(tx, caller, realAudit(tx, caller), id);
      expect(ok.data).toEqual({ id });
      expect((await rates.listContractRates(tx, contractId, "2026-10-20")).data).toEqual([]);
      const contract = await contractService.getContract(tx, contractId, { today: "2026-10-20" });
      expect(contract.data?.currentRate).toBeNull(); // scenario 4: no current rate once the history is empty
    });
    await assertAuditLogged(adminPool, caller.tenantId, "delete", "contract_rate", id);
  });

  it("currentRate is empty when the only rate ended before today (scenario 4)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId, partnerId } = await setup(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      await add(tx, caller, contractId, "2025-01-01", "1000.00", "2025-12-31");
      const list = await contractService.getContracts(tx, partnerId, { today: "2026-10-20" });
      expect(list.data?.[0].currentRate).toBeNull();
      const in2025 = await contractService.getContracts(tx, partnerId, { today: "2025-10-20" });
      expect(in2025.data?.[0].currentRate?.rate).toBe("1000.00");
      // without a today the DTO carries no derived value (writes don't need it)
      const plain = await contractService.getContracts(tx, partnerId);
      expect(plain.data?.[0].currentRate).toBeNull();
    });
  });
});

describe("invariants in the database", () => {
  it("the exclusion constraint refuses an overlapping insert that bypasses the service", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { contractId } = await setup(caller);
    await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      add(tx, caller, contractId, "2026-01-01", "1200.00"),
    );
    await expect(
      adminPool.query(
        `INSERT INTO contract_rates (tenant_id, contract_id, valid_from, valid_to, rate, updated_at, created_by)
         VALUES ($1, $2, '2026-06-01', '2026-06-30', 999.00, NOW(), $3)`,
        [caller.tenantId, contractId, caller.userId],
      ),
    ).rejects.toThrow(/contract_rates_no_overlap/);
    await expect(
      adminPool.query(
        `INSERT INTO contract_rates (tenant_id, contract_id, valid_from, valid_to, rate, updated_at, created_by)
         VALUES ($1, $2, '2020-02-01', '2020-01-01', 999.00, NOW(), $3)`,
        [caller.tenantId, contractId, caller.userId],
      ),
    ).rejects.toThrow(/contract_rates_valid_range_check/);
    await expect(
      adminPool.query(
        `INSERT INTO contract_rates (tenant_id, contract_id, valid_from, rate, updated_at, created_by)
         VALUES ($1, $2, '2020-01-01', 0, NOW(), $3)`,
        [caller.tenantId, contractId, caller.userId],
      ),
    ).rejects.toThrow(/contract_rates_rate_positive_check/);
    // a contract with rates cannot be deleted from under them
    await expect(
      adminPool.query("DELETE FROM contracts WHERE id = $1", [contractId]),
    ).rejects.toThrow(/contract_rates_contract_id_fkey/);
  });

  it("RLS: another tenant sees no rates and cannot add one to the contract", async () => {
    const a = (await createAuthenticatedContext(auth, "owner")).callerIdentity;
    const b = (await createAuthenticatedContext(auth, "owner")).callerIdentity;
    const { contractId } = await setup(a);
    await withTenantTransaction(prisma, a.tenantId, (tx) =>
      add(tx, a, contractId, "2026-01-01", "1200.00"),
    );
    await withTenantTransaction(prisma, b.tenantId, async (tx) => {
      expect((await rates.listContractRates(tx, contractId, "2026-10-20")).data).toEqual([]);
      expect(await rates.rateFor(tx, contractId, "2026-06-01")).toBeNull();
      expect((await add(tx, b, contractId, "2027-01-01", "1.00")).error?.code).toBe("NOT_FOUND");
    });
  });
});
