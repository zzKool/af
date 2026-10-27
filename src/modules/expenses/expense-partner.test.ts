// F87 (specs/expense-partner, D49 D50): an optional partner on expenses, against the real database (RLS on).
// FR-001 the refusals, FR-002 / SC-003 a fact changeable in every state, FR-010 / SC-001 key, base and duplicate
// matches unchanged, US3 / SC-002 spend per partner: the filtered list and the partner page's read agree.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import type { ListQuery } from "@/kernel/list-query/types";
import * as partners from "@/modules/partners";
import {
  FIXTURE,
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  seedRates,
  setupOwner,
} from "./__fixtures__/harness";
import { findExpenseDuplicates } from "./duplicates";
import {
  attachBankTransaction,
  createExpense,
  createPerDiemExpense,
  type ExpenseInput,
  updateExpense,
} from "./expenses";
import { createGroup } from "./groups";
import {
  distinctExpenseValues,
  expensesForPartner,
  getExpenseDetail,
  listExpenses,
} from "./queries";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  mockHeaders = new Headers();
  await seedRates(adminPool);
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

const Q: ListQuery = { page: 1, pageSize: 50, sort: [], filters: {} };

async function vendor(
  caller: CallerIdentity,
  name: string,
  extra: Partial<partners.CreatePartnerInput> = {},
): Promise<string> {
  const p = await run(caller, (tx) =>
    partners.createPartner(tx, caller, noopAudit, {
      name,
      types: ["vendor"],
      externalIdentifiers: [],
      ...extra,
    }),
  );
  expect(p.error).toBeUndefined();
  return p.data!.id;
}

async function group(): Promise<string> {
  const g = await run(owner.caller, (tx) =>
    createGroup(tx, owner.caller, noopAudit, {
      description: FIXTURE.group.description,
      kind: "trip",
    }),
  );
  return g.data!.id;
}

const dinner = (groupId: string, extra: Partial<ExpenseInput> = {}): ExpenseInput => ({
  groupId,
  date: "2026-03-10",
  description: "Restaurant Le Cerf",
  basCode: "583",
  amount: "120.00",
  currency: "CHF",
  paidFromAccountId: owner.sources.privateCh.id,
  ...extra,
});

describe("FR-001 — who can be an expense's partner", () => {
  it("an active vendor of the tenant; inactive, client-only, unknown or another tenant's → refused", async () => {
    const g = await group();
    const cerf = await vendor(owner.caller, "Restaurant Le Cerf");
    const client = await run(owner.caller, (tx) =>
      partners.createPartner(tx, owner.caller, noopAudit, {
        name: "Vaudoise",
        types: ["client"],
        externalIdentifiers: [],
      }),
    );
    const closed = await vendor(owner.caller, "Closed Bistro");
    await run(owner.caller, (tx) =>
      partners.deactivatePartner(tx, owner.caller, noopAudit, closed),
    );
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    const foreign = await vendor(other, "Foreign Vendor");

    const ok = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, dinner(g, { partnerId: cerf })),
    );
    expect(ok.error).toBeUndefined();
    expect(ok.data?.partnerId).toBe(cerf);

    for (const [id, message] of [
      [closed, /Unknown or inactive partner/],
      [foreign, /Unknown or inactive partner/],
      ["00000000-0000-4000-8000-000000000000", /Unknown or inactive partner/],
      [client.data!.id, /Pick a vendor/],
    ] as const) {
      const r = await run(owner.caller, (tx) =>
        createExpense(tx, owner.caller, noopAudit, dinner(g, { partnerId: id, amount: "99.00" })),
      );
      expect(r.error?.message).toMatch(message);
      expect(r.error?.details).toEqual({ field: "partnerId" });
    }

    // US1-5: without a partner the expense is valid, as before
    const none = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, dinner(g, { amount: "33.00" })),
    );
    expect(none.data?.partnerId).toBeNull();
  });

  it("a per-diem never has one: the service refuses it, and so does the database (CHECK)", async () => {
    const g = await group();
    const cerf = await vendor(owner.caller, "Restaurant Le Cerf");
    const refused = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        ...dinner(g, { partnerId: cerf }),
        kind: "per_diem",
        currency: "SEK",
        paidFromAccountId: owner.sources.privateSe.id,
      }),
    );
    expect(refused.error?.message).toMatch(/per-diem has no partner/);

    const perDiem = await run(owner.caller, (tx) =>
      createPerDiemExpense(tx, owner.caller, noopAudit, {
        groupId: g,
        date: "2026-03-12",
        description: "Per diem CH",
        basCode: "580",
        amount: "580.00",
      }),
    );
    expect(perDiem.data?.partnerId).toBeNull();
    const update = await run(owner.caller, (tx) =>
      updateExpense(tx, owner.caller, noopAudit, perDiem.data!.id, { partnerId: cerf }),
    );
    expect(update.error?.message).toMatch(/per-diem has no partner/);
    await expect(
      adminPool.query(`UPDATE expenses SET partner_id = $2 WHERE id = $1`, [
        perDiem.data!.id,
        cerf,
      ]),
    ).rejects.toThrow(/expenses_per_diem_no_partner_check/);
  });
});

describe("FR-010 / SC-001 — nothing else changes with a partner", () => {
  it("the same key, base and status with and without a partner; the duplicate matches are the same", async () => {
    const g = await group();
    const cerf = await vendor(owner.caller, "Restaurant Le Cerf", {
      defaultBasCategoryCode: "583",
    });
    const without = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, dinner(g)),
    );
    const g2 = await run(owner.caller, (tx) =>
      createGroup(tx, owner.caller, noopAudit, { description: "Twin group", kind: "batch" }),
    );
    // a twin group numbered 214: same alias, same seq → the keys differ only by the group number
    const withP = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, dinner(g2.data!.id, { partnerId: cerf })),
    );
    expect(without.data?.key).toBe("Ex213-Rep-01");
    expect(withP.data?.key).toBe("Ex214-Rep-01");
    for (const f of [
      "alias",
      "seq",
      "amountBase",
      "rate",
      "rateSource",
      "baseProvisional",
    ] as const) {
      expect(withP.data?.[f]).toEqual(without.data?.[f]);
    }
    // the check compares the description (the merchant), not the partner: both rows match the same query
    const matches = await run(owner.caller, (tx) =>
      findExpenseDuplicates(tx, {
        merchant: "Restaurant Le Cerf",
        amount: "120.00",
        currency: "CHF",
        date: "2026-03-11",
      }),
    );
    expect(matches.map((m) => m.entityId).sort()).toEqual(
      [without.data!.id, withP.data!.id].sort(),
    );
  });
});

describe("FR-002 / SC-003 — the partner is a fact: changed in every state, audited", () => {
  it("open, paid, partially refunded, refunded: the partner moves, nothing else does; the lock accepts it", async () => {
    const g = await group();
    const sas = await vendor(owner.caller, "SAS");
    const cerf = await vendor(owner.caller, "Restaurant Le Cerf");

    // open (private, nothing settled)
    const open = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, dinner(g, { amount: "10.00" })),
    );
    // paid (company-paid, bank row attached)
    const paid = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        ...dinner(g, { amount: "45.00", description: "Flight" }),
        paidFromAccountId: owner.sources.afSek.id,
      }),
    );
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-12", amount: "-523.17", details: "Kortköp 260310 SAS" },
      ]),
    );
    await run(owner.caller, (tx) =>
      attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: paid.data!.id,
        bankTransactionId: rowId,
      }),
    );
    // partially refunded and refunded (private, settlement lines — the lock's other fact)
    const partial = await run(owner.caller, (tx) =>
      createExpense(
        tx,
        owner.caller,
        noopAudit,
        dinner(g, { amount: "20.00", description: "Taxi" }),
      ),
    );
    const full = await run(owner.caller, (tx) =>
      createExpense(
        tx,
        owner.caller,
        noopAudit,
        dinner(g, { amount: "30.00", description: "Hotel" }),
      ),
    );
    const [refundRow] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-31", amount: "-400.00", name: "Zikrija" },
      ]),
    );
    await adminPool.query(
      `INSERT INTO settlements (tenant_id, number, bank_transaction_id, paid_from_account_id, refund_amount, refund_currency, refund_base, allocated_base, updated_at, created_by)
       VALUES ($1, 'ST26-001', $2, $3, -400, 'SEK', 400, 400, now(), $4)`,
      [owner.caller.tenantId, refundRow, owner.sources.privateCh.id, owner.caller.userId],
    );
    await adminPool.query(
      `INSERT INTO settlement_lines (tenant_id, settlement_id, expense_id, allocated_base, created_by)
       SELECT $1::uuid, id, $2::uuid, 100, $4::uuid FROM settlements WHERE number = 'ST26-001'
       UNION ALL SELECT $1::uuid, id, $3::uuid, $5::numeric, $4::uuid FROM settlements WHERE number = 'ST26-001'`,
      [
        owner.caller.tenantId,
        partial.data!.id,
        full.data!.id,
        owner.caller.userId,
        full.data!.amountBase,
      ],
    );

    const states: [string, string][] = [
      [open.data!.id, "to_refund"],
      [paid.data!.id, "paid"],
      [partial.data!.id, "partially_refunded"],
      [full.data!.id, "refunded"],
    ];
    for (const [id, status] of states) {
      const before = (await run(owner.caller, (tx) => getExpenseDetail(tx, id))).data!;
      expect(before.status).toBe(status);
      for (const partnerId of [sas, cerf, null]) {
        const r = await run(owner.caller, (tx) =>
          updateExpense(tx, owner.caller, realAudit(tx, owner.caller), id, { partnerId }),
        );
        expect(r.error).toBeUndefined();
        expect(r.data?.partnerId).toBe(partnerId);
        const { partnerId: _p, updatedAt: _u, ...rest } = r.data!;
        const { partnerId: _bp, updatedAt: _bu, ...was } = before.expense;
        expect(rest).toEqual(was);
      }
      const after = (await run(owner.caller, (tx) => getExpenseDetail(tx, id))).data!;
      expect(after.status).toBe(status);
      // the History names the field (three updates: set, change, clear)
      expect(after.history.filter((h) => h.fields.includes("partnerId"))).toHaveLength(3);
    }
    // the database lock (superuser, no service) lets a settled row's partner change too
    await adminPool.query(`UPDATE expenses SET partner_id = $2 WHERE id = $1`, [
      full.data!.id,
      sas,
    ]);
    await expect(
      adminPool.query(`UPDATE expenses SET amount = 1 WHERE id = $1`, [full.data!.id]),
    ).rejects.toThrow(/expense_locked/);
  });

  it("a deactivated partner stays on its expenses (greyed in the panel); a change to it is refused", async () => {
    const g = await group();
    const closing = await vendor(owner.caller, "Closing Bistro");
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, dinner(g, { partnerId: closing })),
    );
    await run(owner.caller, (tx) =>
      partners.deactivatePartner(tx, owner.caller, noopAudit, closing),
    );
    const kept = await run(owner.caller, (tx) =>
      updateExpense(tx, owner.caller, noopAudit, e.data!.id, { partnerId: closing, note: "x" }),
    );
    expect(kept.error).toBeUndefined();
    const detail = (await run(owner.caller, (tx) => getExpenseDetail(tx, e.data!.id))).data!;
    expect(detail.partner).toEqual({ id: closing, name: "Closing Bistro", isActive: false });
    const other = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, dinner(g, { amount: "55.00" })),
    );
    const refused = await run(owner.caller, (tx) =>
      updateExpense(tx, owner.caller, noopAudit, other.data!.id, { partnerId: closing }),
    );
    expect(refused.error?.message).toMatch(/Unknown or inactive partner/);
  });
});

describe("US3 / SC-002 — spend per partner", () => {
  it("the list filtered on P and the partner page's read agree, to the öre; (blank) counted", async () => {
    const g = await group();
    const p = await vendor(owner.caller, "SAS");
    const q = await vendor(owner.caller, "Restaurant Le Cerf");
    const mk = (extra: Partial<ExpenseInput>) =>
      run(owner.caller, (tx) => createExpense(tx, owner.caller, noopAudit, dinner(g, extra)));
    await mk({ partnerId: p, amount: "100.00", description: "SAS flight" });
    // company-paid SEK, not yet attached: provisional base
    await mk({
      partnerId: p,
      amount: "1500.00",
      currency: "SEK",
      description: "SAS baggage",
      paidFromAccountId: owner.sources.afChf.id,
      date: "2026-03-11",
    });
    await mk({
      partnerId: p,
      amount: "250.00",
      currency: "SEK",
      description: "SAS lounge",
      paidFromAccountId: owner.sources.privateSe.id,
      date: "2026-03-12",
    });
    await mk({ partnerId: q, amount: "80.00", description: "Dinner" });
    await mk({ amount: "12.00", description: "Taxi" });

    await run(owner.caller, async (tx) => {
      const filtered = await listExpenses(tx, {
        ...Q,
        filters: { partnerId: { kind: "in", values: [p] } },
      });
      expect(filtered.total).toBe(3);
      expect(filtered.rows.every((r) => r.partnerName === "SAS")).toBe(true);
      const byName = await listExpenses(tx, {
        ...Q,
        filters: { partnerName: { kind: "in", values: ["SAS"] } },
      });
      expect(byName.total).toBe(3);
      const sum = filtered.rows.reduce((s, r) => s + Math.round(Number(r.amountBase) * 100), 0);

      const page = await expensesForPartner(tx, p);
      expect(page.count).toBe(3);
      expect(Math.round(Number(page.totalBase) * 100)).toBe(sum);
      expect(page.anyProvisional).toBe(true);
      expect(page.rows.map((r) => r.date)).toEqual(["2026-03-12", "2026-03-11", "2026-03-10"]);
      expect(page.rows[0]?.stateFamily).toBe("attention");
      expect((await expensesForPartner(tx, q)).anyProvisional).toBe(false);

      const values = await distinctExpenseValues(tx, "partnerName", Q);
      expect(values.map((v) => [v.value, v.count])).toEqual(
        expect.arrayContaining([
          ["SAS", 3],
          ["Restaurant Le Cerf", 1],
          [null, 1],
        ]),
      );
      // the search box finds by partner name
      expect((await listExpenses(tx, { ...Q, search: "le cerf" })).total).toBe(1);
    });

    // RLS: another tenant's read is empty
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    await withTenantTransaction(prisma, other.tenantId, async (tx) => {
      expect((await expensesForPartner(tx, p)).count).toBe(0);
    });
  });
});
