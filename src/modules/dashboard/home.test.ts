// The home's read on the real modules (F138, FR-006 – FR-008): an invented world (D51) on 2026-07-15 — a CHF main
// account with balances in June and July, a SEK main account with one in July, rates every weekday → the cash in
// SEK with its month, the tickers, the year's counts, the owner's close (the accountant gets none).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData, createTestDocument, createTestPartner } from "@/kernel/db/test-fixtures";
import { createExpense, createGroup } from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  run,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import { expectedCharges, makeRecurring } from "@/modules/subscriptions";
import { bookFacts, homeData } from "./home";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
const TODAY = "2026-07-15";

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  // 1 EUR = 11 SEK and 0.88 CHF → 1 CHF = 12.5 SEK, every day from 1 April
  for (
    let d = new Date("2026-04-01T00:00:00Z");
    d <= new Date(`${TODAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 11), ($1, 'EUR/CHF', 0.88), ($1, 'EUR/USD', 1.1)`,
      [d.toISOString().slice(0, 10)],
    );
  }
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

async function world() {
  await run(owner.caller, async (tx) => {
    // newest first, as Nordea exports: the first row of a day carries the day's last balance
    await importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
      { date: "2026-07-10", amount: "-200.00", name: "INVENTED SHOP", balance: "9800.00" },
      { date: "2026-06-20", amount: "-100.00", name: "INVENTED CAFE", balance: "8000.00" },
      { date: "2026-06-20", amount: "8100.00", name: "INVENTED CLIENT", balance: "8100.00" },
    ]);
    await importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
      { date: "2026-07-02", amount: "5000.00", name: "INVENTED TRANSFER", balance: "5000.00" },
    ]);
  });
}

describe("homeData (F138)", () => {
  it("the cash in SEK today and its month, each account's share, the CHF exposure", async () => {
    await world();
    const h = await run(owner.caller, (tx) => homeData(tx, owner.caller, TODAY, null));
    // 9 800 × 12.5 + 5 000 = 127 500; end of June 8 000 × 12.5 = 100 000
    expect(h.cash.base).toBe("SEK");
    expect(h.cash.total).toBe("127500.00");
    expect(h.cash.monthDelta).toBe("27500.00");
    expect(h.cash.series.at(-2)).toEqual({ day: "2026-06-30", total: "100000.00" });
    expect(h.cash.series[0]?.total).toBeNull();
    expect(h.cash.accounts.find((a) => a.currency === "CHF")).toMatchObject({
      balance: "9800.00",
      inBase: "122500.00",
      share: 96,
    });
    expect(h.cash.exposure).toEqual([{ currency: "CHF", onePercent: "1225.00" }]);
  });

  it("the tickers against SEK, the year's rows, the owner's close", async () => {
    await world();
    const h = await run(owner.caller, (tx) => homeData(tx, owner.caller, TODAY, null));
    expect(h.currencies.map((c) => [c.currency, c.now, c.change])).toEqual([
      ["CHF", "12.500000", 0],
      ["EUR", "11.000000", 0],
      ["USD", "10.000000", 0],
    ]);
    expect(h.year).toEqual({ year: "2026", justified: 0, toJustify: 4 });
    expect(h.work?.close.month).toBe("2026-06");
    // the books are up to date: the year ends today
    expect(h.booksTo).toBeNull();
  });

  it("books that stop before last month: the year, the strip and Work end in their last month (F189)", async () => {
    await world();
    // the same books, read eight months later with nothing imported since
    const later = "2027-03-10";
    const h = await run(owner.caller, (tx) => homeData(tx, owner.caller, later, null));
    const lastRow = h.weeks.weeks.filter((w) => w.rows > 0).at(-1);
    expect(h.booksTo).toBe(`${TODAY.slice(0, 7)}-31`);
    expect(h.year.year).toBe("2026");
    expect(h.year.justified + h.year.toJustify).toBe(4);
    // the strip's last week holds the books' last day — not eight empty months
    expect((h.weeks.weeks.at(-1)?.to ?? "") >= (h.booksTo ?? "")).toBe(true);
    expect(lastRow).toBeDefined();
    expect(h.work?.close.month).toBe(TODAY.slice(0, 7));
  });
});

describe("bookFacts (F171)", () => {
  it("the expenses and documents of the strip's weeks, each with its module's state, mapped", async () => {
    const g = await run(owner.caller, (tx) =>
      createGroup(tx, owner.caller, noopAudit, { description: "Invented trip", kind: "batch" }),
    );
    const groupId = g.data?.id ?? "";
    const expense = (date: string, documentMissing: boolean) =>
      run(owner.caller, (tx) =>
        createExpense(tx, owner.caller, noopAudit, {
          groupId,
          date,
          description: "Invented lunch",
          basCode: "5800",
          amount: "120.00",
          currency: "SEK",
          paidFromAccountId: owner.sources.privateSe.id,
          documentMissing,
        }),
      );
    expect((await expense("2026-07-10", true)).error).toBeUndefined(); // to refund: open
    expect((await expense("2026-05-04", false)).error).toBeUndefined(); // before last month: late
    expect((await expense("2025-01-06", false)).error).toBeUndefined(); // outside the year
    const doc = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      status: "extracted",
    });
    await adminPool.query(
      `UPDATE documents SET created_at = '2026-07-13T08:00:00Z', updated_at = '2026-07-13T08:00:00Z' WHERE id = $1`,
      [doc.id],
    );

    const books = await run(owner.caller, (tx) => bookFacts(tx, owner.caller, TODAY));
    expect([...books.expenses].sort((a, b) => a.date.localeCompare(b.date))).toEqual([
      { date: "2026-05-04", cell: "late" },
      { date: "2026-07-10", cell: "open" },
    ]);
    expect(books.documents).toEqual([{ date: "2026-07-13", cell: "open" }]); // ready: to review
    expect(books.invoices).toEqual([]);

    const h = await run(owner.caller, (tx) => homeData(tx, owner.caller, TODAY, null));
    expect(h.weeks.weeks.at(-1)?.books.documents).toEqual({ cell: "open", count: 1, pending: 1 });
  });
});

describe("the subscriptions row (F181)", () => {
  it("each expected charge of the strip's weeks with its period's state, mapped; nothing after the strip", async () => {
    const vendor = await createTestPartner(adminPool, owner.caller.tenantId, owner.caller.userId, {
      name: "Invented Kodkassen",
      types: ["vendor"],
    });
    const g = await run(owner.caller, (tx) =>
      createGroup(tx, owner.caller, noopAudit, { description: "Kodkassen", kind: "batch" }),
    );
    const groupId = g.data?.id ?? "";
    const doc = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      status: "extracted",
    });
    // June's charge, paid privately, its receipt attached → the period is done
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        groupId,
        date: "2026-06-10",
        description: "Kodkassen",
        basCode: "5800",
        amount: "199.00",
        currency: "SEK",
        paidFromAccountId: owner.sources.privateSe.id,
        documentId: doc.id,
      }),
    );
    expect(e.error).toBeUndefined();
    const s = await run(owner.caller, (tx) =>
      makeRecurring(tx, owner.caller, noopAudit, {
        entity: { type: "expense", id: e.data?.id ?? "" },
        subscription: {
          name: "Kodkassen",
          partnerId: vendor.id,
          becomes: "expense",
          basCode: "5800",
          groupId,
          paidFromAccountId: owner.sources.privateSe.id,
          cadence: "monthly",
          startDate: "2026-05-10",
          price: { amount: "199.00", currency: "SEK" },
        },
      }),
    );
    expect(s.error).toBeUndefined();

    const charges = await run(owner.caller, (tx) =>
      expectedCharges(tx, owner.caller, "2026-05-01", "2026-07-19", TODAY),
    );
    expect(charges.map((c) => [c.date, c.state])).toEqual([
      ["2026-05-10", "due"],
      ["2026-06-10", "done"],
      ["2026-07-10", "due"],
    ]);

    const books = await run(owner.caller, (tx) => bookFacts(tx, owner.caller, TODAY));
    // May: before last month → late; June: done; July: open; August's (upcoming) is after the strip
    expect(books.subscriptions).toEqual([
      { date: "2026-05-10", cell: "late" },
      { date: "2026-06-10", cell: "done" },
      { date: "2026-07-10", cell: "open" },
    ]);
    // the accountant reads the same row
    const theirs = await run(owner.caller, (tx) =>
      bookFacts(tx, { ...owner.caller, role: "accountant" }, TODAY),
    );
    expect(theirs.subscriptions).toEqual(books.subscriptions);
  });
});
