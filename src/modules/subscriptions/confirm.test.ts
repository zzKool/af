// F94 (specs/subscriptions US3, US4, SC-002, SC-005, SC-006) against the real database, RLS on: a card row and a
// receipt / bill fill their period in one confirm, through the owning modules — and nothing happens without one.
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
import * as supplierInvoices from "@/modules/supplier-invoices";
import {
  inboxDocument,
  seedOctoberRates,
  subscription,
  TODAY,
  vendor,
} from "./__fixtures__/harness";
import { confirm, confirmAllExact, confirmPrefill } from "./confirm";
import { attentionCounts, getSubscriptionDetail, listSubscriptions } from "./queries";
import type { SubscriptionInput } from "./subscriptions";

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

const Q = { page: 1, pageSize: 50, sort: [], filters: {} };

async function sekSubscription(o: Partial<SubscriptionInput> = {}) {
  const partnerId = await vendor(adminPool, owner.caller, o.name ?? "Byteform AB");
  return subscription(owner.caller, {
    name: "Byteform",
    partnerId,
    becomes: "expense",
    basCode: "580",
    newGroup: { description: o.name ?? "Byteform" },
    paymentSourceId: owner.sources.afSek.id,
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

const counts = async () => {
  const r = await adminPool.query(
    `SELECT (SELECT count(*) FROM expenses)::int AS e, (SELECT count(*) FROM supplier_invoices)::int AS s,
            (SELECT count(*) FROM links)::int AS l`,
  );
  return r.rows[0] as { e: number; s: number; l: number };
};
const journal = async () =>
  (
    await adminPool.query(
      `SELECT id, amount, currency, amount_base, rate, bas_code, partner_id, no_document_needed, categorised_by
       FROM journal_entries ORDER BY id`,
    )
  ).rows;

const detail = (id: string) =>
  run(owner.caller, (tx) => getSubscriptionDetail(tx, owner.caller, id, TODAY)).then(
    (d) => d.data!,
  );

describe("US3 — a card row fills its period, one confirm", () => {
  it("SEK: the row is offered (match waiting); confirm creates the expense from the row, attaches it, attributes it", async () => {
    const id = await sekSubscription();
    const rowId = await sekRow("2026-10-16", "-199.00");
    const before = await detail(id);
    const oct = before.periods.find((p) => p.date === "2026-10-15")!;
    expect(oct).toMatchObject({ state: "due", marks: ["match_waiting"] });
    expect(oct.rows).toEqual([expect.objectContaining({ rowId, exact: true, ambiguous: false })]);

    const journalBefore = await journal();
    const r = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        realAudit(tx, owner.caller),
        { subscriptionId: id, periodDate: "2026-10-15", bankTransactionId: rowId },
        TODAY,
      ),
    );
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({ created: true, attachedRow: true, attachedDocument: false });
    expect(r.data?.entity.key).toMatch(/^Ex\d+-Tr-01$/); // SC-005: the key of a hand-made expense
    const e = await adminPool.query(
      "SELECT amount, currency, date, amount_base, rate_source, paid_amount, partner_id FROM expenses WHERE id = $1",
      [r.data!.entity.id],
    );
    expect(e.rows[0]).toMatchObject({
      amount: "199.00",
      currency: "SEK",
      amount_base: "199.00",
      rate_source: "bank",
      paid_amount: "199.00",
    });
    const after = await detail(id);
    expect(after.periods.find((p) => p.date === "2026-10-15")).toMatchObject({
      state: "charged",
      marks: ["receipt_missing"], // its receipt window closed on the 25th
    });
    expect(await journal()).toEqual(journalBefore); // SC-006: a subscription never writes the journal
  });

  it("Q1 A: a EUR subscription charged on the SEK card waits for the receipt; receipt + row in one confirm", async () => {
    const partnerId = await vendor(adminPool, owner.caller, "Tabula GmbH");
    const id = await subscription(owner.caller, {
      name: "Tabula Pro",
      partnerId,
      becomes: "expense",
      basCode: "580",
      newGroup: { description: "Tabula Pro" },
      paymentSourceId: owner.sources.afSek.id,
      cadence: "monthly",
      startDate: "2026-09-14",
      matchText: "TABULA",
      price: { amount: "22.00", currency: "EUR" },
    });
    // 22.00 EUR × 11.50 = 253.00 SEK; the card took 257.10 (FX markup 1.6 %)
    const rowId = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-10-15", amount: "-257.10", name: "TABULA*PRO" },
      ]),
    ).then((x) => x[0]!);
    const period = (await detail(id)).periods.find((p) => p.date === "2026-10-14")!;
    expect(period.rows).toEqual([
      expect.objectContaining({ rowId, crossCurrency: true, exact: false }),
    ]);

    const pre = await run(owner.caller, (tx) =>
      confirmPrefill(
        tx,
        owner.caller,
        { subscriptionId: id, periodDate: "2026-10-14", bankTransactionId: rowId },
        TODAY,
      ),
    );
    expect(pre.data).toMatchObject({ facts: null, waitingFor: "receipt" });
    const refused = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, periodDate: "2026-10-14", bankTransactionId: rowId },
        TODAY,
      ),
    );
    expect(refused.error?.details).toEqual({ waitingFor: "receipt" });
    const typed = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        {
          subscriptionId: id,
          periodDate: "2026-10-14",
          bankTransactionId: rowId,
          facts: {
            date: "2026-10-15",
            description: "Tabula Pro",
            amount: "22.00",
            currency: "EUR",
          },
        },
        TODAY,
      ),
    );
    expect(typed.error?.details).toEqual({ waitingFor: "receipt" }); // never from an expected amount

    const docId = await inboxDocument(adminPool, owner.caller, {
      merchantName: "Tabula GmbH",
      transactionDate: "2026-10-14",
      invoiceTotal: 22,
      currency: "EUR",
    });
    const offered = (await detail(id)).periods.find((p) => p.date === "2026-10-14")!;
    expect(offered.documents).toEqual([
      expect.objectContaining({ documentId: docId, diffPct: "0.00" }),
    ]);
    const r = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        {
          subscriptionId: id,
          periodDate: "2026-10-14",
          bankTransactionId: rowId,
          documentId: docId,
        },
        TODAY,
      ),
    );
    expect(r.error).toBeUndefined();
    const e = await adminPool.query(
      "SELECT amount, currency, paid_amount, paid_currency, amount_base, rate_source FROM expenses WHERE id = $1",
      [r.data!.entity.id],
    );
    // D26: the receipt's amount in its currency, the bank row's SEK as the base
    expect(e.rows[0]).toMatchObject({
      amount: "22.00",
      currency: "EUR",
      paid_amount: "257.10",
      paid_currency: "SEK",
      amount_base: "257.10",
      rate_source: "bank",
    });
    expect((await detail(id)).periods.find((p) => p.date === "2026-10-14")?.state).toBe("done");
  });

  it("US4-4: a charged period gets its receipt later — attached, money facts untouched, done", async () => {
    const id = await sekSubscription();
    const rowId = await sekRow("2026-10-16", "-199.00");
    const made = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, periodDate: "2026-10-15", bankTransactionId: rowId },
        TODAY,
      ),
    );
    const money = () =>
      adminPool
        .query(
          "SELECT amount, currency, amount_base, rate, paid_amount FROM expenses WHERE id = $1",
          [made.data!.entity.id],
        )
        .then((r) => r.rows[0]);
    const before = await money();
    const docId = await inboxDocument(adminPool, owner.caller, {
      merchantName: "Byteform AB",
      transactionDate: "2026-10-16",
      invoiceTotal: 199,
      currency: "SEK",
    });
    const period = (await detail(id)).periods.find((p) => p.date === "2026-10-15")!;
    expect(period).toMatchObject({ state: "charged", marks: ["match_waiting"] });
    const r = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, periodDate: "2026-10-15", documentId: docId },
        TODAY,
      ),
    );
    expect(r.data).toMatchObject({ created: false, attachedDocument: true, attachedRow: false });
    expect(await money()).toEqual(before);
    expect((await detail(id)).periods.find((p) => p.date === "2026-10-15")?.state).toBe("done");
  });

  it("Confirm all exact (US3-8): the exact ones in one action; a 3 % off charge is left for the owner", async () => {
    const a = await sekSubscription();
    const b = await sekSubscription({
      name: "Kodkassen",
      matchText: "KODKASSEN",
      startDate: "2026-10-05",
      price: { amount: "100.00", currency: "SEK" },
    });
    await sekRow("2026-10-16", "-199.00");
    await sekRow("2026-10-06", "-103.00", "KODKASSEN AB"); // 3 %: a match, not exact
    const report = await run(owner.caller, (tx) =>
      confirmAllExact(tx, owner.caller, noopAudit, TODAY),
    );
    expect(report.data?.confirmed.map((c) => c.subscriptionId)).toEqual([a]);
    expect(report.data?.skipped).toEqual([
      expect.objectContaining({ subscriptionId: b, periodDate: "2026-10-05", reason: "not_exact" }),
    ]);
  });
});

describe("US4 — a bill fills a supplier-invoice period; its payment stays the supplier invoice's", () => {
  async function billSubscription() {
    const partnerId = await vendor(
      adminPool,
      owner.caller,
      "Siffra Redovisning AB",
      "SE556999888801",
    );
    return subscription(owner.caller, {
      name: "Accounting",
      partnerId,
      becomes: "supplier_invoice",
      basCode: "583",
      newGroup: { description: "Accounting" },
      paymentSourceId: owner.sources.afSek.id,
      cadence: "monthly",
      startDate: "2026-09-30",
      price: { amount: "1500.00", currency: "SEK" },
    });
  }
  const bill = (number: string, date: string) =>
    inboxDocument(
      adminPool,
      owner.caller,
      {
        vendorName: "Siffra Redovisning AB",
        vendorTaxId: "SE 556999888801",
        invoiceNumber: number,
        invoiceDate: date,
        invoiceTotal: 1500,
        subtotal: 1200,
        totalTax: 300,
        currency: "SEK",
      },
      "invoice",
    );

  it("the bill is offered (VAT number → certain); confirm creates the supplier invoice unpaid, from the document", async () => {
    const id = await billSubscription();
    const docId = await bill("4711", "2026-10-31");
    const period = (await detail(id)).periods.find((p) => p.date === "2026-10-30")!;
    expect(period.documents).toEqual([
      expect.objectContaining({ documentId: docId, certain: true }),
    ]);
    const r = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, periodDate: "2026-10-30", documentId: docId },
        TODAY,
      ),
    );
    expect(r.error).toBeUndefined();
    const si = await run(owner.caller, (tx) =>
      supplierInvoices.supplierInvoiceRowsByIds(tx, [r.data!.entity.id], TODAY),
    );
    expect(si[0]).toMatchObject({
      invoiceNumber: "4711",
      invoiceDate: "2026-10-31",
      amountTotal: "1500.00",
      status: "unpaid",
      hasDocument: true,
    });
    expect((await detail(id)).periods.find((p) => p.date === "2026-10-30")?.state).toBe(
      "documented",
    );
  });

  it("a row never creates a supplier invoice; no bill → refused; the same invoice number twice → refused, nothing written (D35)", async () => {
    const id = await billSubscription();
    const rowId = await sekRow("2026-10-30", "-1500.00", "SIFFRA REDOVISNING");
    const viaRow = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, periodDate: "2026-10-30", bankTransactionId: rowId },
        TODAY,
      ),
    );
    expect(viaRow.error?.message).toMatch(/own panel/);
    const first = await bill("4711", "2026-09-30");
    await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, periodDate: "2026-09-30", documentId: first },
        TODAY,
      ),
    );
    const before = await counts();
    const again = await bill("4711", "2026-10-31");
    const r = await run(owner.caller, (tx) =>
      confirm(
        tx,
        owner.caller,
        noopAudit,
        { subscriptionId: id, periodDate: "2026-10-30", documentId: again },
        TODAY,
      ),
    );
    expect(r.error).toBeDefined();
    expect(await counts()).toEqual(before);
  });
});

describe("SC-002 — nothing happens without a click", () => {
  it("import, receipts and every read leave expenses, supplier invoices and links untouched", async () => {
    const id = await sekSubscription();
    const before = await counts();
    await sekRow("2026-10-16", "-199.00");
    await inboxDocument(adminPool, owner.caller, {
      merchantName: "Byteform AB",
      transactionDate: "2026-10-16",
      invoiceTotal: 199,
      currency: "SEK",
    });
    await run(owner.caller, async (tx) => {
      await listSubscriptions(tx, owner.caller, Q, TODAY);
      await getSubscriptionDetail(tx, owner.caller, id, TODAY);
      await attentionCounts(tx, owner.caller, TODAY);
      await confirmPrefill(
        tx,
        owner.caller,
        { subscriptionId: id, periodDate: "2026-10-15" },
        TODAY,
      );
    });
    expect(await counts()).toEqual(before);
    const att = await run(owner.caller, (tx) => attentionCounts(tx, owner.caller, TODAY));
    expect(att).toMatchObject({ periods: 1, toConfirm: 1 });
    const list = await run(owner.caller, (tx) => listSubscriptions(tx, owner.caller, Q, TODAY));
    expect(list.rows[0]).toMatchObject({
      attention: 1,
      nextDate: "2026-11-15",
      expectedAmount: "199.00",
    });
  });
});
