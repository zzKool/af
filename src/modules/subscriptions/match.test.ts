// US7 (F183, specs/subscriptions FR-015) against the real database, RLS on: which subscription period a bank row /
// an inbox document is offered to — the same read as the page, nothing written. Invented values only (D51).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import {
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  seedRates,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import {
  inboxDocument,
  seedOctoberRates,
  subscription,
  TODAY,
  vendor,
} from "./__fixtures__/harness";
import { confirm } from "./confirm";
import { matchForDocument, matchForRow, periodName } from "./match";
import { addPause, type SubscriptionInput } from "./subscriptions";

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
  await seedOctoberRates(adminPool);
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

async function byteform(o: Partial<SubscriptionInput> = {}, vat?: string) {
  const partnerId = await vendor(adminPool, owner.caller, "Byteform AB", vat);
  return subscription(owner.caller, {
    name: "Byteform",
    partnerId,
    becomes: "expense",
    basCode: "5800",
    newGroup: { description: "Byteform" },
    paidFromAccountId: owner.sources.afSek.id,
    cadence: "monthly",
    startDate: "2026-10-15",
    matchText: "BYTEFORM",
    price: { amount: "199.00", currency: "SEK" },
    ...o,
  });
}

const sekRow = (date: string, amount: string, name = "BYTEFORM AB") =>
  run(owner.caller, (tx) =>
    importRows(tx, owner.caller, owner.accounts.sek, "SEK", [{ date, amount, name }]),
  ).then((ids) => ids[0]!);

const forRow = (rowId: string) =>
  run(owner.caller, (tx) => matchForRow(tx, owner.caller, rowId, TODAY));
const forDocument = (documentId: string) =>
  run(owner.caller, (tx) => matchForDocument(tx, owner.caller, documentId, TODAY));

const receipt = (o: Record<string, unknown> = {}) =>
  inboxDocument(adminPool, owner.caller, {
    merchantName: "Byteform AB",
    transactionDate: "2026-10-16",
    invoiceTotal: 199,
    currency: "SEK",
    ...o,
  });

const writes = async () =>
  (
    await adminPool.query(
      `SELECT (SELECT count(*) FROM expenses)::int AS e, (SELECT count(*) FROM supplier_invoices)::int AS s,
              (SELECT count(*) FROM links)::int AS l`,
    )
  ).rows[0];

describe("periodName", () => {
  it("a monthly period is its month, a yearly one its year", () => {
    expect(periodName("2026-10-15", "monthly")).toBe("2026-10");
    expect(periodName("2026-03-02", "yearly")).toBe("2026");
  });
});

describe("matchForRow (US7-1)", () => {
  it("a row in the window, by the text, at the price → the period, exact, nothing written", async () => {
    const id = await byteform();
    const rowId = await sekRow("2026-10-16", "-199.00");
    const before = await writes();
    expect(await forRow(rowId)).toEqual([
      {
        subscriptionId: id,
        name: "Byteform",
        becomes: "expense",
        cadence: "monthly",
        periodDate: "2026-10-15",
        period: "2026-10",
        state: "due",
        entityKey: null,
        sure: true,
        ambiguous: false,
        diffPct: "0.00",
      },
    ]);
    expect(await writes()).toEqual(before);
  });

  it("no match: another vendor's row, or a row outside the window", async () => {
    await byteform();
    expect(await forRow(await sekRow("2026-10-16", "-199.00", "PIXELHUS"))).toEqual([]);
    expect(await forRow(await sekRow("2026-10-25", "-199.00"))).toEqual([]);
  });

  it("a paused period takes no row", async () => {
    const id = await byteform();
    const p = await run(owner.caller, (tx) =>
      addPause(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, fromDate: "2026-10-01", toDate: "2026-10-31", note: "on hold" },
        TODAY,
      ),
    );
    expect(p.error).toBeUndefined();
    expect(await forRow(await sekRow("2026-10-16", "-199.00"))).toEqual([]);
  });

  it("the wrong amount (beyond the tolerance) is no match; within it, a match that is not exact", async () => {
    await byteform();
    expect(await forRow(await sekRow("2026-10-16", "-250.00"))).toEqual([]);
    const near = await forRow(await sekRow("2026-10-17", "-205.00"));
    expect(near).toEqual([expect.objectContaining({ sure: false, diffPct: "3.02" })]);
  });

  it("the wrong currency: a EUR price is compared converted, so the same number in SEK is no match", async () => {
    await byteform({ price: { amount: "22.00", currency: "EUR" } });
    expect(await forRow(await sekRow("2026-10-16", "-22.00"))).toEqual([]);
    // 22.00 EUR × 11.50 = 253.00 SEK: offered, never exact (another currency)
    expect(await forRow(await sekRow("2026-10-17", "-253.00"))).toEqual([
      expect.objectContaining({ sure: false, diffPct: "0.00" }),
    ]);
  });
});

describe("matchForDocument (US7-2)", () => {
  it("a receipt of the vendor at the price → the period; the VAT number makes it sure", async () => {
    await byteform({}, "SE556000111101");
    const docId = await receipt();
    expect(await forDocument(docId)).toEqual([
      expect.objectContaining({ period: "2026-10", sure: false, entityKey: null }),
    ]);
    const vatDoc = await receipt({ vendorTaxId: "SE556000111101", transactionDate: "2026-10-18" });
    expect(await forDocument(vatDoc)).toEqual([expect.objectContaining({ sure: true })]);
  });

  it("no match: the wrong amount, the wrong currency, another vendor, a paused period", async () => {
    const id = await byteform();
    expect(await forDocument(await receipt({ invoiceTotal: 260 }))).toEqual([]);
    // 199 EUR against a 199 SEK price (17.30 EUR)
    expect(await forDocument(await receipt({ currency: "EUR" }))).toEqual([]);
    expect(await forDocument(await receipt({ merchantName: "Pixelhus AB" }))).toEqual([]);
    await run(owner.caller, (tx) =>
      addPause(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, fromDate: "2026-10-01", toDate: "2026-10-31", note: "on hold" },
        TODAY,
      ),
    );
    expect(await forDocument(await receipt())).toEqual([]);
  });

  it("a charged period offers the receipt to complete its expense (the entity's key)", async () => {
    const id = await byteform();
    const rowId = await sekRow("2026-10-16", "-199.00");
    const c = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        realAudit(tx, owner.caller),
        { subscriptionId: id, periodDate: "2026-10-15", bankTransactionId: rowId },
        TODAY,
      ),
    );
    expect(c.error).toBeUndefined();
    // the row is justified now: no longer offered
    expect(await forRow(rowId)).toEqual([]);
    expect(await forDocument(await receipt())).toEqual([
      expect.objectContaining({ state: "charged", entityKey: c.data!.entity.key }),
    ]);
  });
});
