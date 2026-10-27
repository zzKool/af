// F94 (specs/subscriptions T014): `outgoingRowsInWindow` — the subscriptions module's row candidates, read here so
// that module never reads `bank_transactions`. Real database, RLS on; invented rows.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import * as expenses from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  run,
  seedRates,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import { outgoingRowsInWindow } from "./queries";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
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
  await seedRates(adminPool);
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

describe("outgoingRowsInWindow", () => {
  it("outgoing rows of the given accounts inside the window (inclusive), every text field, what is left", async () => {
    const [before, first, incoming, last, after] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-11", amount: "-10.00", name: "BEFORE" },
        { date: "2026-03-12", amount: "-199.00", name: "BYTEFORM AB", message: "Kortköp" },
        { date: "2026-03-15", amount: "50.00", name: "REFUND" },
        { date: "2026-03-22", amount: "-20.00", name: "LAST" },
        { date: "2026-03-23", amount: "-30.00", name: "AFTER" },
      ]),
    );
    await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sav, "SEK", [
        { date: "2026-03-15", amount: "-5.00", name: "SAVINGS" },
      ]),
    );
    const rows = await run(owner.caller, (tx) =>
      outgoingRowsInWindow(tx, {
        bankAccountIds: [owner.accounts.sek],
        from: "2026-03-12",
        to: "2026-03-22",
      }),
    );
    expect(rows.map((r) => r.id)).toEqual([first, last]);
    expect([before, incoming, after]).not.toContain(rows[0]?.id);
    expect(rows[0]).toMatchObject({
      bookingDate: "2026-03-12",
      amount: "199.00",
      currency: "SEK",
      amountBase: "199.00",
      remaining: "199.00",
      partnerId: null,
      noDocumentNeeded: false,
    });
    expect(rows[0]?.texts).toEqual(expect.arrayContaining(["BYTEFORM AB", "Kortköp"]));
    expect(
      await run(owner.caller, (tx) =>
        outgoingRowsInWindow(tx, { bankAccountIds: [], from: "2026-03-12", to: "2026-03-22" }),
      ),
    ).toEqual([]);
  });

  it("a row already justified in full is dropped", async () => {
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-12", amount: "-199.00", name: "BYTEFORM AB" },
      ]),
    );
    const g = await run(owner.caller, (tx) =>
      expenses.createGroup(tx, owner.caller, noopAudit, { description: "x", kind: "batch" }),
    );
    await run(owner.caller, async (tx) => {
      const e = await expenses.createExpense(tx, owner.caller, noopAudit, {
        groupId: g.data!.id,
        date: "2026-03-12",
        description: "Byteform",
        basCode: "580",
        amount: "199.00",
        currency: "SEK",
        paymentSourceId: owner.sources.afSek.id,
      });
      await expenses.attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: e.data!.id,
        bankTransactionId: rowId!,
      });
    });
    const rows = await run(owner.caller, (tx) =>
      outgoingRowsInWindow(tx, {
        bankAccountIds: [owner.accounts.sek],
        from: "2026-03-01",
        to: "2026-03-31",
      }),
    );
    expect(rows).toEqual([]);
  });
});
