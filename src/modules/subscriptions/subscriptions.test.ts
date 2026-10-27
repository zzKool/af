// F94 (specs/subscriptions US1, US2, US5) against the real database, RLS on: describe once (the refusals, + New
// group), prices like contract rates, pauses, delete / end, the periods' states read from real entities.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData, createTestPartner } from "@/kernel/db/test-fixtures";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as expenses from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  seedRates,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import * as linking from "@/modules/linking";
import { seedOctoberRates, subscription, TODAY, vendor } from "./__fixtures__/harness";
import { getSubscriptionDetail, listSubscriptions } from "./queries";
import {
  addPause,
  addPrice,
  createSubscription,
  deleteSubscription,
  makeRecurring,
  removePrice,
  type SubscriptionInput,
  updateSubscription,
} from "./subscriptions";
import { ruleFromSubscription, toRule } from "./to-rule";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
let byteform: string;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  await seedRates(adminPool);
  await seedOctoberRates(adminPool);
  owner = await setupOwner(adminPool, nordeaFormatId);
  byteform = await vendor(adminPool, owner.caller, "Byteform AB");
});
afterAll(async () => {
  await adminPool.end();
});

const Q = { page: 1, pageSize: 50, sort: [], filters: {} };
const input = (o: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
  name: "Byteform",
  partnerId: byteform,
  becomes: "expense",
  basCode: "580",
  newGroup: { description: "Byteform" },
  paidFromAccountId: owner.sources.afSek.id,
  cadence: "monthly",
  startDate: "2026-01-15",
  price: { amount: "199.00", currency: "SEK" },
  ...o,
});
const create = (o: Partial<SubscriptionInput> = {}) =>
  run(owner.caller, (tx) =>
    createSubscription(tx, owner.caller, realAudit(tx, owner.caller), input(o)),
  );

describe("US1 — describe a subscription once", () => {
  it("creates it with its own batch group (Q2 B) and its first price from the start date; audited", async () => {
    const r = await create();
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({ name: "Byteform", tolerancePct: "5.00", becomes: "expense" });
    const detail = await run(owner.caller, (tx) =>
      getSubscriptionDetail(tx, owner.caller, r.data!.id, TODAY),
    );
    expect(detail.data?.groupLabel).toMatch(/Byteform/);
    expect(detail.data?.prices).toEqual([
      expect.objectContaining({ validFrom: "2026-01-15", validTo: null, amount: "199.00" }),
    ]);
    const g = await run(owner.caller, (tx) => expenses.getGroup(tx, r.data!.groupId));
    expect(g.data?.kind).toBe("batch");
    await assertAuditLogged(adminPool, owner.caller.tenantId, "create", "subscription", r.data!.id);
  });

  it("an existing group can be picked instead (two subscriptions may share one)", async () => {
    const g = await run(owner.caller, (tx) =>
      expenses.createGroup(tx, owner.caller, noopAudit, { description: "SaaS", kind: "batch" }),
    );
    const a = await create({ newGroup: undefined, groupId: g.data!.id });
    const b = await create({ name: "Other", newGroup: undefined, groupId: g.data!.id });
    expect(a.data?.groupId).toBe(g.data!.id);
    expect(b.data?.groupId).toBe(g.data!.id);
  });

  it("refuses (US1-2, US1-3): a client, an inactive vendor, an inactive BAS, a private payer for a bill, bad dates, a tolerance over 50, a name twice, no group", async () => {
    const client = await createTestPartner(adminPool, owner.caller.tenantId, owner.caller.userId, {
      types: ["client"],
    });
    const inactive = await createTestPartner(
      adminPool,
      owner.caller.tenantId,
      owner.caller.userId,
      {
        types: ["vendor"],
        isActive: false,
      },
    );
    expect((await create({ partnerId: client.id })).error?.message).toMatch(/Pick a vendor/);
    expect((await create({ partnerId: inactive.id })).error?.message).toMatch(/inactive partner/);
    expect((await create({ basCode: "6540" })).error?.message).toMatch(/not active/);
    expect((await create({ basCode: "657" })).error?.message).toMatch(/no short code/);
    expect(
      (await create({ becomes: "supplier_invoice", paidFromAccountId: owner.sources.privateSe.id }))
        .error?.message,
    ).toMatch(/paid from a company account/);
    expect((await create({ endDate: "2026-01-14" })).error?.message).toMatch(/end date/);
    expect((await create({ tolerancePct: "50.01" })).error?.message).toMatch(/at most 50/);
    expect((await create({ newGroup: undefined })).error?.message).toMatch(/Pick a group/);
    expect((await create({ price: { amount: "0", currency: "SEK" } })).error).toBeDefined();
    expect((await create()).error).toBeUndefined();
    expect((await create({ name: "byteform" })).error?.message).toMatch(/exists/);
  });

  it("an update changes the facts for later; becomes a private payer for a bill → refused", async () => {
    const r = await create({ becomes: "supplier_invoice" });
    const u = await run(owner.caller, (tx) =>
      updateSubscription(tx, owner.caller, noopAudit, r.data!.id, {
        matchText: "BYTEFORM",
        tolerancePct: "10",
      }),
    );
    expect(u.data).toMatchObject({ matchText: "BYTEFORM", tolerancePct: "10.00" });
    const bad = await run(owner.caller, (tx) =>
      updateSubscription(tx, owner.caller, noopAudit, r.data!.id, {
        paidFromAccountId: owner.sources.privateSe.id,
      }),
    );
    expect(bad.error?.message).toMatch(/company account/);
  });

  it("another tenant sees nothing", async () => {
    await create();
    const other = await setupOwner(adminPool, nordeaFormatId);
    const list = await run(other.caller, (tx) => listSubscriptions(tx, other.caller, Q, TODAY));
    expect(list.total).toBe(0);
  });
});

describe("US5 — prices, pauses, the end", () => {
  it("a new price closes the previous on the day before; overlapping or before the start refused; the latest removable", async () => {
    const r = await create();
    const id = r.data!.id;
    const p = await run(owner.caller, (tx) =>
      addPrice(tx, owner.caller, noopAudit, {
        subscriptionId: id,
        validFrom: "2026-09-15",
        amount: "219.00",
        currency: "SEK",
      }),
    );
    expect(p.error).toBeUndefined();
    await run(owner.caller, async (tx) => {
      const detail = await getSubscriptionDetail(tx, owner.caller, id, TODAY);
      expect(detail.data?.prices.map((x) => [x.validFrom, x.validTo, x.amount])).toEqual([
        ["2026-01-15", "2026-09-14", "199.00"],
        ["2026-09-15", null, "219.00"],
      ]);
      const sep = detail.data?.periods.find((x) => x.date === "2026-09-15");
      const aug = detail.data?.periods.find((x) => x.date === "2026-08-15");
      expect(sep?.price?.amount).toBe("219.00");
      expect(aug?.price?.amount).toBe("199.00");
      const again = await addPrice(tx, owner.caller, noopAudit, {
        subscriptionId: id,
        validFrom: "2026-09-15",
        amount: "1.00",
        currency: "SEK",
      });
      expect(again.error?.message).toMatch(/already starts/);
      const before = await addPrice(tx, owner.caller, noopAudit, {
        subscriptionId: id,
        validFrom: "2026-01-15",
        amount: "1.00",
        currency: "SEK",
      });
      expect(before.error?.message).toMatch(/after the subscription's start/);
    });
    const removed = await run(owner.caller, (tx) =>
      removePrice(tx, owner.caller, noopAudit, p.data!.id),
    );
    expect(removed.error).toBeUndefined();
    const left = await run(owner.caller, (tx) =>
      getSubscriptionDetail(tx, owner.caller, id, TODAY),
    );
    expect(left.data?.prices).toEqual([expect.objectContaining({ validTo: null })]);
  });

  it("a pause skips its periods (US5-3); refused over a period that has an expense", async () => {
    const r = await create();
    const id = r.data!.id;
    const ok = await run(owner.caller, (tx) =>
      addPause(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, fromDate: "2026-07-01", toDate: "2026-08-31", note: "summer" },
        TODAY,
      ),
    );
    expect(ok.error).toBeUndefined();
    const detail = await run(owner.caller, (tx) =>
      getSubscriptionDetail(tx, owner.caller, id, TODAY),
    );
    expect(detail.data?.periods.filter((p) => p.state === "skipped").map((p) => p.date)).toEqual([
      "2026-08-15",
      "2026-07-15",
    ]);

    // an expense attributed to March → a pause over March refused
    const e = await run(owner.caller, (tx) =>
      expenses.createExpense(tx, owner.caller, noopAudit, {
        groupId: r.data!.groupId,
        date: "2026-03-16",
        description: "Byteform",
        basCode: "580",
        amount: "199.00",
        currency: "SEK",
        paidFromAccountId: owner.sources.afSek.id,
      }),
    );
    await run(owner.caller, (tx) =>
      linking.createLink(tx, owner.caller, noopAudit, {
        from: { type: "expense", id: e.data!.id },
        to: { type: "subscription", id },
        kind: "occurrence_of",
      }),
    );
    const bad = await run(owner.caller, (tx) =>
      addPause(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, fromDate: "2026-03-01", toDate: "2026-03-31", note: "x" },
        TODAY,
      ),
    );
    expect(bad.error?.message).toMatch(/2026-03-15 already has/);
  });

  it("delete refused once an entity is attributed (end it instead); an end date stops the periods", async () => {
    const r = await create();
    const id = r.data!.id;
    const e = await run(owner.caller, (tx) =>
      expenses.createExpense(tx, owner.caller, noopAudit, {
        groupId: r.data!.groupId,
        date: "2026-02-15",
        description: "Byteform",
        basCode: "580",
        amount: "199.00",
        currency: "SEK",
        paidFromAccountId: owner.sources.afSek.id,
      }),
    );
    await run(owner.caller, (tx) =>
      linking.createLink(tx, owner.caller, noopAudit, {
        from: { type: "expense", id: e.data!.id },
        to: { type: "subscription", id },
        kind: "occurrence_of",
      }),
    );
    const del = await run(owner.caller, (tx) =>
      deleteSubscription(tx, owner.caller, noopAudit, id),
    );
    expect(del.error?.message).toMatch(/end it instead/);
    await run(owner.caller, (tx) =>
      updateSubscription(tx, owner.caller, noopAudit, id, { endDate: "2026-04-15" }),
    );
    const list = await run(owner.caller, (tx) => listSubscriptions(tx, owner.caller, Q, TODAY));
    expect(list.rows[0]).toMatchObject({ active: false, nextDate: null });
    const detail = await run(owner.caller, (tx) =>
      getSubscriptionDetail(tx, owner.caller, id, TODAY),
    );
    expect(detail.data?.periods.map((p) => p.date)).toEqual([
      "2026-04-15",
      "2026-03-15",
      "2026-02-15",
      "2026-01-15",
    ]);
    const fresh = await create({ name: "Unused" });
    expect(
      (
        await run(owner.caller, (tx) =>
          deleteSubscription(tx, owner.caller, noopAudit, fresh.data!.id),
        )
      ).data,
    ).toEqual({ deleted: true });
  });
});

describe("US2 — the periods' state from real entities", () => {
  it("a paid expense with its receipt is done; paid without receipt charged; nothing → charge missing after the window", async () => {
    const id = await subscription(owner.caller, input());
    const [rowSep, rowOct] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-09-16", amount: "-199.00", name: "BYTEFORM AB" },
        { date: "2026-10-16", amount: "-199.00", name: "BYTEFORM AB" },
      ]),
    );
    const make = async (date: string, rowId: string) => {
      const sub = await run(owner.caller, (tx) =>
        getSubscriptionDetail(tx, owner.caller, id, TODAY),
      );
      const e = await run(owner.caller, async (tx) => {
        const created = await expenses.createExpense(tx, owner.caller, noopAudit, {
          groupId: sub.data!.subscription.groupId,
          date,
          description: "Byteform",
          basCode: "580",
          amount: "199.00",
          currency: "SEK",
          paidFromAccountId: owner.sources.afSek.id,
        });
        const attached = await expenses.payExpense(tx, owner.caller, noopAudit, {
          expenseId: created.data!.id,
          bankTransactionId: rowId,
        });
        expect(attached.error).toBeUndefined();
        await linking.createLink(tx, owner.caller, noopAudit, {
          from: { type: "expense", id: created.data!.id },
          to: { type: "subscription", id },
          kind: "occurrence_of",
        });
        return created.data!;
      });
      return e;
    };
    await make("2026-09-16", rowSep!);
    await make("2026-10-16", rowOct!);
    const detail = await run(owner.caller, (tx) =>
      getSubscriptionDetail(tx, owner.caller, id, TODAY),
    );
    const byDate = new Map(detail.data!.periods.map((p) => [p.date, p]));
    expect(byDate.get("2026-11-15")?.state).toBe("upcoming");
    expect(byDate.get("2026-10-15")).toMatchObject({
      state: "charged",
      marks: ["receipt_missing"],
    });
    expect(byDate.get("2026-09-15")).toMatchObject({
      state: "charged",
      marks: ["receipt_missing"],
    });
    expect(byDate.get("2026-08-15")).toMatchObject({ state: "due", marks: ["charge_missing"] });
    expect(detail.data!.periods[0]?.date).toBe("2026-11-15"); // newest first, the upcoming on top
  });

  it("Make it recurring (US1-5): the expense becomes the subscription's first period", async () => {
    const g = await run(owner.caller, (tx) =>
      expenses.createGroup(tx, owner.caller, noopAudit, { description: "Byteform", kind: "batch" }),
    );
    const e = await run(owner.caller, (tx) =>
      expenses.createExpense(tx, owner.caller, noopAudit, {
        groupId: g.data!.id,
        date: "2026-10-16",
        description: "Byteform",
        basCode: "580",
        amount: "199.00",
        currency: "SEK",
        paidFromAccountId: owner.sources.privateSe.id,
      }),
    );
    const r = await run(owner.caller, (tx) =>
      makeRecurring(tx, owner.caller, noopAudit, {
        entity: { type: "expense", id: e.data!.id },
        subscription: input({
          newGroup: undefined,
          groupId: g.data!.id,
          startDate: "2026-10-16",
          paidFromAccountId: owner.sources.privateSe.id,
        }),
      }),
    );
    expect(r.error).toBeUndefined();
    const detail = await run(owner.caller, (tx) =>
      getSubscriptionDetail(tx, owner.caller, r.data!.id, TODAY),
    );
    const first = detail.data!.periods.find((p) => p.date === "2026-10-16");
    expect(first?.entities.map((x) => x.id)).toEqual([e.data!.id]);
    // private, no receipt: nothing to pay, the receipt is what is left — its window still open on the 26th
    expect(first?.state).toBe("charged");
    // a second subscription cannot take the same expense
    const twice = await run(owner.caller, (tx) =>
      makeRecurring(tx, owner.caller, noopAudit, {
        entity: { type: "expense", id: e.data!.id },
        subscription: input({ name: "Twice", newGroup: undefined, groupId: g.data!.id }),
      }),
    ).catch((err: Error) => ({ error: { message: err.message } }));
    expect(twice.error?.message).toBeDefined();
  });
});

describe("F116 PR C2 — a subscription as a rule", () => {
  it("makes one rule with its text, account, direction, today's price and cadence; the rule categorises its row", async () => {
    const r = await create({ matchText: "BYTEFORM" });
    expect(r.error).toBeUndefined();
    const made = await run(owner.caller, (tx) =>
      toRule(tx, owner.caller, noopAudit, r.data!.id, TODAY),
    );
    expect(made.error).toBeUndefined();
    const rule = await run(owner.caller, (tx) =>
      tx.categorisationRule.findUniqueOrThrow({ where: { id: made.data!.ruleId } }),
    );
    expect(rule).toMatchObject({
      name: "Byteform (subscription)",
      matchPattern: "BYTEFORM",
      matchField: "all",
      basCode: "580",
      partnerId: byteform,
      bankAccountId: owner.sources.afSek.id,
      sign: "out",
      cadence: "monthly",
    });
    expect(rule.expectedAmount?.toFixed(2)).toBe("199.00");
    expect(rule.tolerancePct.toFixed(2)).toBe("5.00");
    // its row: categorised by the rule on import
    const [row] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-10-15", amount: "-199.00", details: "Kortköp 261014 BYTEFORM AB" },
      ]),
    );
    const t = await run(owner.caller, (tx) =>
      tx.bankTransaction.findUniqueOrThrow({ where: { id: row as string } }),
    );
    expect(t.ruleId).toBe(made.data!.ruleId);
  });

  it("refuses without a match text, or when paid privately", async () => {
    const plain = await create({ name: "No text" });
    const a = await run(owner.caller, (tx) =>
      toRule(tx, owner.caller, noopAudit, plain.data!.id, TODAY),
    );
    expect(a.error?.message).toMatch(/match text/);
    const priv = await create({
      name: "Private one",
      matchText: "PRIVATE",
      paidFromAccountId: owner.sources.privateSe.id,
      newGroup: { description: "Private one" },
    });
    expect(priv.error).toBeUndefined();
    const b = await run(owner.caller, (tx) =>
      toRule(tx, owner.caller, noopAudit, priv.data!.id, TODAY),
    );
    expect(b.error?.message).toMatch(/paid privately/);
  });

  it("a price in another currency than the account's is no amount condition (pure)", () => {
    const base = {
      name: "Tabular",
      matchText: "TABULAR",
      basCode: "540",
      partnerId: "p",
      bankAccountId: "a",
      accountCurrency: "SEK",
      cadence: "yearly" as const,
      tolerancePct: "80.00",
    };
    expect(
      ruleFromSubscription({ ...base, price: { amount: "120.00", currency: "EUR" } }),
    ).toMatchObject({ expectedAmount: null, tolerancePct: "50", cadence: "yearly", sign: "out" });
    expect(
      ruleFromSubscription({ ...base, price: { amount: "1290.00", currency: "SEK" } })
        .expectedAmount,
    ).toBe("1290.00");
  });
});
