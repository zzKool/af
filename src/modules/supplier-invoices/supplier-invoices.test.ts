// Supplier invoices — specs/supplier-invoices/spec.md US1 (record), US2 (payments by link, cross-currency attach,
// cancel, delete), US3 (list, KPIs, pickers), US4 (VAT read model) against the real database, on the expenses
// harness (accounts, aliases, fixture rates, Nordea imports for real bank rows).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData, createTestDocument, createTestPartner } from "@/kernel/db/test-fixtures";
import type { ListQuery } from "@/kernel/list-query/types";
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
  storage,
} from "@/modules/expenses/__fixtures__/harness";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { findSupplierInvoiceDuplicates } from "./duplicates";
import { attachPayment, detachPayment, recordPayment, removePayment } from "./payments";
import {
  candidateDocuments,
  getSupplierInvoiceDetail,
  inputVatForPeriod,
  kpis,
  listForGroup,
  listSupplierInvoices,
  payableTransactions,
  supplierOptions,
} from "./queries";
import {
  cancelSupplierInvoice,
  copyLastPrefill,
  createSupplierInvoice,
  deleteSupplierInvoice,
  type SupplierInvoiceInput,
  uncancelSupplierInvoice,
  updateSupplierInvoice,
} from "./supplier-invoices";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/kernel/storage/storage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/kernel/storage/storage")>();
  return { ...mod, createStorageService: () => storage };
});

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
let groupId: string;
let skattepunkten: string;
let saas: string;
let chReg: string;
const Q: ListQuery = { page: 1, pageSize: 50, sort: [], filters: {} };

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
  const vendor = await createTestPartner(adminPool, owner.caller.tenantId, owner.caller.userId, {
    name: "Skattepunkten Office Services AB",
    types: ["vendor"],
    defaultCurrency: "CHF",
    defaultBasCategoryCode: "653",
  });
  skattepunkten = vendor.id;
  saas = (
    await createTestPartner(adminPool, owner.caller.tenantId, owner.caller.userId, {
      name: "OpenAI",
      types: ["vendor"],
      defaultCurrency: "EUR",
    })
  ).id;
  const ids = await run(owner.caller, async (tx) => {
    await settings.activateBasCategories(tx, owner.caller, noopAudit, ["653", "654"]);
    await settings.updateBasPreference(tx, owner.caller, noopAudit, "653", { shortCode: "Acc" });
    await settings.updateBasPreference(tx, owner.caller, noopAudit, "654", { shortCode: "IT" });
    const g = await expenses.createGroup(tx, owner.caller, noopAudit, {
      description: "2026-03 — March",
      kind: "batch",
    });
    const reg = await settings.createVatRegistration(tx, owner.caller, noopAudit, {
      country: "CH",
      vatNumber: "CHE-123.456.789 MWST",
    });
    return { groupId: g.data!.id, chReg: reg.data!.id };
  });
  groupId = ids.groupId;
  chReg = ids.chReg;
});
afterAll(async () => {
  await adminPool.end();
});

/** The accountant's July invoice of the spec, dated in the fixture's March (a Saturday → Friday's rate). */
const julyInvoice = (over: Partial<SupplierInvoiceInput> = {}): SupplierInvoiceInput => ({
  groupId,
  partnerId: skattepunkten,
  invoiceNumber: "9160",
  invoiceDate: "2026-03-14",
  amountNet: "1200.00",
  vatAmount: "97.20",
  amountTotal: "1297.20",
  basCode: "653",
  vatRegistrationId: chReg,
  ...over,
});

const create = (input: SupplierInvoiceInput) =>
  run(owner.caller, (tx) =>
    createSupplierInvoice(tx, owner.caller, realAudit(tx, owner.caller), input),
  );

const detail = (id: string, today = "2026-04-01") =>
  run(owner.caller, async (tx) => {
    const d = await getSupplierInvoiceDetail(tx, owner.caller, id, today);
    if (d.error) throw new Error(d.error.message);
    return d.data;
  });

const chfRow = (date: string, amount: string, name = "Skattepunkten") =>
  run(owner.caller, async (tx) => {
    const [id] = await importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
      { date, amount, name },
    ]);
    return id;
  });

describe("US1 — record a supplier invoice", () => {
  it("keys, the alias snapshot and the counter shared with the group's expenses", async () => {
    const first = await create(julyInvoice());
    expect(first.error).toBeUndefined();
    expect(first.data).toMatchObject({
      key: "SI213-Acc-01",
      seq: 1,
      alias: "Acc",
      currency: "CHF",
      amountTotal: "1297.20",
      // Saturday 03-14 → Friday 03-13 at 10.76: 1 297.20 × 10.76
      amountBase: "13957.87",
      rateSource: "ecb_nearest",
      rateDate: "2026-03-13",
      dueDate: "2026-04-13",
      dueDateDefaulted: true,
      vatRegistrationId: chReg,
      lines: [],
    });
    await run(owner.caller, async (tx) => {
      await assertAuditLogged(
        adminPool,
        owner.caller.tenantId,
        "create",
        "supplier_invoice",
        first.data!.id,
      );
      // an expense in the same group and category takes the next number of the same series (D28)
      const e = await expenses.createExpense(tx, owner.caller, noopAudit, {
        groupId,
        date: "2026-03-12",
        description: "Bokföring",
        basCode: "653",
        amount: "100.00",
        currency: "SEK",
        paymentSourceId: owner.sources.afSek.id,
      });
      expect(e.data?.key).toBe("Ex213-Acc-02");
    });
    const third = await create(julyInvoice({ invoiceNumber: "9161", invoiceDate: "2026-03-31" }));
    expect(third.data?.key).toBe("SI213-Acc-03");
    const it1 = await create(
      julyInvoice({ partnerId: saas, invoiceNumber: "INV-1", basCode: "654", currency: "EUR" }),
    );
    expect(it1.data).toMatchObject({ key: "SI213-IT-01", currency: "EUR" });
  });

  it("the partner's terms and currency pre-fill; SEK rate 1; a typed rate is manual; no rate → refused", async () => {
    await run(owner.caller, (tx) =>
      partners.updatePartner(tx, owner.caller, noopAudit, skattepunkten, { paymentTermsDays: 20 }),
    );
    const r = await create(julyInvoice({ invoiceDate: "2026-03-11" }));
    expect(r.data).toMatchObject({
      dueDate: "2026-03-31",
      dueDateDefaulted: true,
      currency: "CHF",
    });
    const sek = await create(
      julyInvoice({
        invoiceNumber: "9170",
        currency: "SEK",
        invoiceDate: "2026-03-11",
        dueDate: "2026-03-20",
      }),
    );
    expect(sek.data).toMatchObject({
      amountBase: "1297.20",
      rate: "1",
      rateSource: "same_currency",
      rateDate: null,
      dueDateDefaulted: false,
    });
    const manual = await create(
      julyInvoice({ invoiceNumber: "9171", invoiceDate: "2026-03-11", rate: "10.5" }),
    );
    expect(manual.data).toMatchObject({ amountBase: "13620.60", rateSource: "manual" });
    const usd = await create(
      julyInvoice({ invoiceNumber: "9172", invoiceDate: "2026-03-11", currency: "USD" }),
    );
    expect(usd.error?.message).toMatch(/No exchange rate/);
  });

  it("refuses: wrong total, negative VAT, due before invoice, not a vendor, unknown alias, a duplicate number per supplier", async () => {
    const total = await create(julyInvoice({ amountTotal: "1297.30" }));
    expect(total.error?.message).toMatch(/must equal net 1200.00 \+ VAT 97.20/);
    const ok = await create(julyInvoice({ amountTotal: "1297.21" }));
    expect(ok.error).toBeUndefined();
    const due = await create(julyInvoice({ invoiceNumber: "x", dueDate: "2026-03-13" }));
    expect(due.error?.message).toMatch(/due date cannot be before/);
    const client = await createTestPartner(adminPool, owner.caller.tenantId, owner.caller.userId, {
      name: "Vattenfall",
      types: ["client"],
    });
    const notVendor = await create(julyInvoice({ invoiceNumber: "x", partnerId: client.id }));
    expect(notVendor.error?.message).toMatch(/not a vendor/);
    const noAlias = await create(julyInvoice({ invoiceNumber: "x", basCode: "657" }));
    expect(noAlias.error?.message).toMatch(/no short code/);
    const dup = await create(julyInvoice({ invoiceNumber: " 9160 " }));
    expect(dup.error?.message).toBe(
      "Invoice 9160 of this supplier is already recorded as SI213-Acc-01",
    );
    const otherSupplier = await create(julyInvoice({ partnerId: saas, currency: "EUR" }));
    expect(otherSupplier.error).toBeUndefined();
  });

  it("from a document (D27, D28): the key carries the vendor's slug, one origin per document", async () => {
    const doc = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      businessKey: "inv_20260314_001",
      fileName: "inv_20260314_001.pdf",
      prefixType: "invoice",
      status: "extracted",
    });
    const candidates = await run(owner.caller, (tx) => candidateDocuments(tx, owner.caller));
    expect(candidates.map((c) => c.id)).toContain(doc.id);
    const r = await create(julyInvoice({ documentId: doc.id }));
    expect(r.error).toBeUndefined();
    await run(owner.caller, async (tx) => {
      const d = await tx.document.findUnique({ where: { id: doc.id } });
      expect(d?.businessKey).toBe("SI213-Acc-01_2026-03-14_Skattepunkten_Office_Services_AB");
      expect(d?.fileName).toBe("SI213-Acc-01_2026-03-14_Skattepunkten_Office_Services_AB.pdf");
      const second = await createSupplierInvoice(tx, owner.caller, noopAudit, {
        ...julyInvoice({ invoiceNumber: "9161" }),
        documentId: doc.id,
      });
      expect(second.error?.message).toMatch(/already became supplier_invoice/);
      const del = await deleteSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id);
      expect(del.error?.message).toMatch(/linked/);
      expect(await candidateDocuments(tx, owner.caller)).toEqual([]);
    });
    const d = await detail(r.data!.id);
    expect(d.document?.businessKey).toBe(
      "SI213-Acc-01_2026-03-14_Skattepunkten_Office_Services_AB",
    );
    expect(d.links.map((l) => l.kind)).toEqual(["created_from"]);
    expect(d.editable).toBe(true);
  });

  it("lines: Σ net and Σ VAT must match; each line has its category; replaced on update", async () => {
    const bad = await create(
      julyInvoice({
        lines: [
          {
            lineNo: 1,
            description: "Bokföring",
            amountNet: "1000.00",
            vatRate: "8.10",
            vatAmount: "81.00",
            basCode: "653",
          },
          {
            lineNo: 2,
            description: "Software",
            amountNet: "200.00",
            vatRate: "8.10",
            vatAmount: "17.20",
            basCode: "654",
          },
        ],
      }),
    );
    expect(bad.error?.message).toMatch(/lines' VAT 98.20 must equal the invoice VAT 97.20/);
    const good = await create(
      julyInvoice({
        lines: [
          {
            lineNo: 1,
            description: "Bokföring",
            amountNet: "1000.00",
            vatRate: "8.10",
            vatAmount: "81.00",
            basCode: "653",
          },
          {
            lineNo: 2,
            description: "Software",
            amountNet: "200.00",
            vatRate: "8.10",
            vatAmount: "16.20",
            basCode: "654",
          },
        ],
      }),
    );
    expect(good.data?.lines.map((l) => [l.lineNo, l.basCode, l.vatAmount])).toEqual([
      [1, "653", "81.00"],
      [2, "654", "16.20"],
    ]);
    const replaced = await run(owner.caller, (tx) =>
      updateSupplierInvoice(tx, owner.caller, noopAudit, good.data!.id, { lines: null }),
    );
    expect(replaced.data?.lines).toEqual([]);
  });

  it("money facts change only while open (the base is recomputed); note and category change freely", async () => {
    const r = await create(julyInvoice());
    const moved = await run(owner.caller, (tx) =>
      updateSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id, {
        invoiceDate: "2026-03-11",
        dueDate: "2026-04-10",
        amountNet: "1300.00",
        vatAmount: "105.30",
        amountTotal: "1405.30",
      }),
    );
    // 1 405.30 × 10.80 (03-11, ecb_daily)
    expect(moved.data).toMatchObject({
      amountBase: "15177.24",
      rateSource: "ecb_daily",
      rateDate: "2026-03-11",
      dueDate: "2026-04-10",
      dueDateDefaulted: false,
    });
    const row = await chfRow("2026-03-31", "-1405.30");
    await run(owner.caller, async (tx) => {
      const paid = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: row,
      });
      expect(paid.error).toBeUndefined();
      const locked = await updateSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id, {
        amountTotal: "1405.31",
      });
      expect(locked.error?.message).toMatch(/has a payment/);
      const free = await updateSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id, {
        note: "July fee",
        basCode: "654",
        vatRegistrationId: null,
        documentMissing: true,
      });
      expect(free.data).toMatchObject({
        note: "July fee",
        basCode: "654",
        alias: "Acc",
        vatRegistrationId: null,
        documentMissing: true,
      });
    });
  });

  it("an edit keeps a manual rate and a typed due date; a defaulted due date follows the date and terms (audit 5)", async () => {
    await run(owner.caller, (tx) =>
      partners.updatePartner(tx, owner.caller, noopAudit, skattepunkten, { paymentTermsDays: 20 }),
    );
    const r = await create(julyInvoice({ invoiceDate: "2026-03-11", rate: "10.5" }));
    expect(r.data).toMatchObject({
      amountBase: "13620.60",
      rate: "10.5",
      rateSource: "manual",
      dueDate: "2026-03-31",
      dueDateDefaulted: true,
    });
    const update = (input: Parameters<typeof updateSupplierInvoice>[4]) =>
      run(owner.caller, (tx) =>
        updateSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id, input),
      );
    // a money field that is neither the rate, the currency, the date nor the total: nothing re-runs
    const renumbered = await update({ invoiceNumber: "9160-A" });
    expect(renumbered.data).toMatchObject({
      amountBase: "13620.60",
      rate: "10.5",
      rateSource: "manual",
    });
    // a new total: the manual rate stays, only the base follows (1 405.30 × 10.5)
    const retotalled = await update({
      amountNet: "1300.00",
      vatAmount: "105.30",
      amountTotal: "1405.30",
    });
    expect(retotalled.data).toMatchObject({
      amountBase: "14755.65",
      rate: "10.5",
      rateSource: "manual",
      rateDate: null,
    });
    // a new date: the manual rate stays; the defaulted due date follows with the supplier's 20 days
    const redated = await update({ invoiceDate: "2026-03-13" });
    expect(redated.data).toMatchObject({
      rateSource: "manual",
      amountBase: "14755.65",
      dueDate: "2026-04-02",
      dueDateDefaulted: true,
    });
    // a typed due date is kept by a later date change
    await update({ dueDate: "2026-04-30" });
    const typed = await update({ invoiceDate: "2026-03-12", amountTotal: "1405.30" });
    expect(typed.data).toMatchObject({
      dueDate: "2026-04-30",
      dueDateDefaulted: false,
      rateSource: "manual",
    });
    // an ECB rate is asked again only when the date (or the currency) moves
    const ecb = await create(julyInvoice({ invoiceNumber: "9180" }));
    const ecbRenumbered = await run(owner.caller, (tx) =>
      updateSupplierInvoice(tx, owner.caller, noopAudit, ecb.data!.id, { invoiceNumber: "9181" }),
    );
    expect(ecbRenumbered.data).toMatchObject({
      amountBase: "13957.87",
      rateSource: "ecb_nearest",
      rateDate: "2026-03-13",
    });
    const ecbRedated = await run(owner.caller, (tx) =>
      updateSupplierInvoice(tx, owner.caller, noopAudit, ecb.data!.id, {
        invoiceDate: "2026-03-11",
      }),
    );
    // 1 297.20 × 10.80 (03-11, ecb_daily)
    expect(ecbRedated.data).toMatchObject({
      amountBase: "14009.76",
      rateSource: "ecb_daily",
      rateDate: "2026-03-11",
    });
  });

  it("copy last: the supplier's latest invoice as a prefill", async () => {
    expect((await run(owner.caller, (tx) => copyLastPrefill(tx, skattepunkten))).data).toBeNull();
    await create(julyInvoice({ invoiceDate: "2026-03-10", note: "older" }));
    await create(julyInvoice({ invoiceNumber: "9161", invoiceDate: "2026-03-12", note: "latest" }));
    const prefill = await run(owner.caller, (tx) => copyLastPrefill(tx, skattepunkten));
    expect(prefill.data).toEqual({
      currency: "CHF",
      amountNet: "1200.00",
      vatAmount: "97.20",
      amountTotal: "1297.20",
      basCode: "653",
      vatRegistrationId: chReg,
      note: "latest",
      groupId,
    });
  });
});

describe("the duplicate check (specs/documents US3): exact, hash, fuzzy", () => {
  it("same partner + normalised number → high; the same bytes → high; ± 1 % ± 7 days same currency → medium; cancelled ignored", async () => {
    const hash = "b".repeat(64);
    const original = await createTestDocument(
      adminPool,
      owner.caller.tenantId,
      owner.caller.userId,
      {
        businessKey: "inv_20260314_010",
        prefixType: "invoice",
        status: "extracted",
        contentHash: hash,
      },
    );
    const copy = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      businessKey: "inv_20260314_011",
      prefixType: "invoice",
      status: "extracted",
      contentHash: hash,
    });
    const july = await create(julyInvoice({ documentId: original.id })); // 9160, 1 297.20 CHF, 2026-03-14
    expect(july.error).toBeUndefined();
    const cancelled = await create(
      julyInvoice({ invoiceNumber: "9150", invoiceDate: "2026-03-12" }),
    );
    await run(owner.caller, (tx) =>
      cancelSupplierInvoice(tx, owner.caller, noopAudit, cancelled.data!.id, "sent twice"),
    );

    await run(owner.caller, async (tx) => {
      const exact = await findSupplierInvoiceDuplicates(tx, {
        partnerId: skattepunkten,
        invoiceNumber: " 9160 ",
      });
      expect(exact).toHaveLength(1);
      expect(exact[0]).toMatchObject({
        kind: "exact",
        confidence: "high",
        entityId: july.data!.id,
        partnerName: "Skattepunkten Office Services AB",
      });

      const byHash = await findSupplierInvoiceDuplicates(tx, { documentId: copy.id });
      expect(byHash.map((m) => [m.kind, m.entityId])).toEqual([["hash", july.data!.id]]);

      // the exact hit wins over the hash hit for the same entity; a fuzzy twin is a second entry
      const all = await findSupplierInvoiceDuplicates(tx, {
        documentId: copy.id,
        partnerId: skattepunkten,
        invoiceNumber: "9160",
        amount: "1297.20",
        currency: "CHF",
        date: "2026-03-14",
      });
      expect(all.map((m) => m.kind)).toEqual(["exact"]);

      const near = await findSupplierInvoiceDuplicates(tx, {
        partnerId: skattepunkten,
        invoiceNumber: "9199",
        amount: "1290.00",
        currency: "CHF",
        date: "2026-03-19",
      });
      expect(near.map((m) => [m.kind, m.confidence])).toEqual([["fuzzy", "medium"]]);
      expect(near[0].reason.params).toEqual({
        n: "9160",
        amount: "1297.20",
        currency: "CHF",
        date: "2026-03-14",
      });
      // other currency, 8 days, 1.5 % off, another partner: nothing; the cancelled one never counts
      for (const q of [
        { currency: "SEK", date: "2026-03-14", amount: "1297.20" },
        { currency: "CHF", date: "2026-03-22", amount: "1297.20" },
        { currency: "CHF", date: "2026-03-14", amount: "1317.00" },
      ]) {
        expect(
          await findSupplierInvoiceDuplicates(tx, {
            partnerId: skattepunkten,
            invoiceNumber: "x",
            ...q,
          }),
        ).toEqual([]);
      }
      expect(
        await findSupplierInvoiceDuplicates(tx, { partnerId: saas, invoiceNumber: "9160" }),
      ).toEqual([]);
      expect(
        await findSupplierInvoiceDuplicates(tx, {
          partnerId: skattepunkten,
          invoiceNumber: "9150",
        }),
      ).toEqual([]);
    });

    // "Create anyway": the unique (partner, number) index still refuses the very same number — the
    // acknowledgement is for the fuzzy / hash cases; here the copy's bytes with a new number
    const anyway = await create(
      julyInvoice({
        invoiceNumber: "9160-B",
        documentId: copy.id,
        duplicateAck: { entityIds: [july.data!.id], note: "the corrected reissue" },
      }),
    );
    expect(anyway.error).toBeUndefined();
    expect(anyway.data?.note).toBe("Not a duplicate: the corrected reissue");
    const audit = await adminPool.query(
      "SELECT new_data FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'create'",
      [owner.caller.tenantId, anyway.data!.id],
    );
    expect(audit.rows[0].new_data.duplicateAck.note).toBe("the corrected reissue");
  });
});

describe("US2 — paid by a link", () => {
  it("one row pays it: the justifies allocation, paid, open 0.00; removing the link reopens it", async () => {
    const r = await create(julyInvoice());
    const row = await chfRow("2026-03-31", "-1297.20");
    const paid = await run(owner.caller, (tx) =>
      recordPayment(tx, owner.caller, realAudit(tx, owner.caller), {
        invoiceId: r.data!.id,
        bankTransactionId: row,
      }),
    );
    expect(paid.data?.allocated).toBe("1297.20");
    let d = await detail(r.data!.id);
    expect(d).toMatchObject({
      status: "paid",
      allocated: "1297.20",
      open: "0.00",
      editable: false,
    });
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({
      bookingDate: "2026-03-31",
      rowAmount: "-1297.20",
      allocated: "1297.20",
      currency: "CHF",
      note: null,
    });
    // the same row cannot pay it twice; nothing open anyway
    const again = await run(owner.caller, (tx) =>
      recordPayment(tx, owner.caller, noopAudit, { invoiceId: r.data!.id, bankTransactionId: row }),
    );
    expect(again.error?.message).toMatch(/nothing open/);
    const removed = await run(owner.caller, (tx) =>
      removePayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        linkId: d.payments[0].linkId,
      }),
    );
    expect(removed.error).toBeUndefined();
    d = await detail(r.data!.id);
    expect(d).toMatchObject({ status: "unpaid", allocated: "0.00", open: "1297.20" });
  });

  it("instalments: partially paid, then paid; a third refused; beyond the open refused", async () => {
    const r = await create(julyInvoice());
    const [a, b, c] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-20", amount: "-600.00", name: "Skattepunkten" },
        { date: "2026-03-25", amount: "-697.20", name: "Skattepunkten" },
        { date: "2026-03-26", amount: "-100.00", name: "Skattepunkten" },
      ]),
    );
    await run(owner.caller, async (tx) => {
      const first = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: a,
      });
      expect(first.data?.allocated).toBe("600.00");
      const tooMuch = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: b,
        amount: "700.00",
      });
      expect(tooMuch.error?.message).toMatch(/700.00 CHF exceeds the open 697.20 CHF/);
    });
    expect((await detail(r.data!.id)).status).toBe("partially_paid");
    expect((await detail(r.data!.id)).open).toBe("697.20");
    await run(owner.caller, async (tx) => {
      const second = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: b,
      });
      expect(second.data?.allocated).toBe("697.20");
      const third = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: c,
      });
      expect(third.error?.message).toMatch(/nothing open/);
    });
    expect((await detail(r.data!.id)).status).toBe("paid");
    // the batch row that paid two invoices: its remaining allocation shrinks in the picker
    const other = await create(
      julyInvoice({
        invoiceNumber: "9161",
        amountNet: "50.00",
        vatAmount: "0.00",
        amountTotal: "50.00",
      }),
    );
    await run(owner.caller, async (tx) => {
      const paid = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: other.data!.id,
        bankTransactionId: c,
        amount: "50.00",
      });
      expect(paid.error).toBeUndefined();
      const payable = await payableTransactions(tx, "CHF");
      expect(payable.find((t) => t.id === c)?.remaining).toBe("50.00");
      expect(payable.find((t) => t.id === a)).toBeUndefined();
    });
  });

  it("a short payment within the tolerance closes it with the rounding note", async () => {
    const r = await create(julyInvoice());
    const row = await chfRow("2026-03-31", "-1297.15");
    const paid = await run(owner.caller, (tx) =>
      recordPayment(tx, owner.caller, noopAudit, { invoiceId: r.data!.id, bankTransactionId: row }),
    );
    expect(paid.data?.allocated).toBe("1297.15");
    const d = await detail(r.data!.id);
    expect(d.status).toBe("paid");
    expect(d.open).toBe("0.05");
    expect(d.payments[0].note).toMatch(/Rounding adjustment: CHF 0.05/);
  });

  it("cross-currency (D-g): attach the SEK row — the bank's base, rate_source bank, one link; detach restores the ECB base", async () => {
    const r = await create(julyInvoice());
    const [sekRow] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-31", amount: "-14000.00", name: "Skattepunkten" },
      ]),
    );
    const asPayment = await run(owner.caller, (tx) =>
      recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: sekRow,
      }),
    );
    expect(asPayment.error?.message).toMatch(/row is in SEK, the invoice in CHF — attach/);
    const attached = await run(owner.caller, (tx) =>
      attachPayment(tx, owner.caller, realAudit(tx, owner.caller), {
        invoiceId: r.data!.id,
        bankTransactionId: sekRow,
      }),
    );
    expect(attached.data).toMatchObject({
      paidAmount: "14000.00",
      paidCurrency: "SEK",
      amountBase: "14000.00",
      rateSource: "bank",
      amountTotal: "1297.20",
      currency: "CHF",
    });
    let d = await detail(r.data!.id);
    expect(d).toMatchObject({
      status: "paid",
      allocated: "14000.00",
      open: "0.00",
      linkCurrency: "SEK",
    });
    expect(d.payments[0]).toMatchObject({ allocated: "14000.00", currency: "SEK" });
    await run(owner.caller, async (tx) => {
      const again = await attachPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: sekRow,
      });
      expect(again.error?.message).toMatch(/already has its bank row/);
      const remove = await removePayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        linkId: d.payments[0].linkId,
      });
      expect(remove.error?.message).toMatch(/detach it instead/);
      const cancel = await cancelSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id, "x");
      expect(cancel.error?.message).toMatch(/has a payment/);
      const status = await linking.getAllocationStatus(tx, {
        type: "supplier_invoice",
        id: r.data!.id,
      });
      expect(status.data).toMatchObject({ amount: "14000.00", currency: "SEK", remaining: "0.00" });
    });
    const detached = await run(owner.caller, (tx) =>
      detachPayment(tx, owner.caller, noopAudit, r.data!.id),
    );
    expect(detached.data).toMatchObject({
      paidAmount: null,
      paidCurrency: null,
      amountBase: "13957.87",
      rateSource: "ecb_nearest",
    });
    d = await detail(r.data!.id);
    expect(d).toMatchObject({ status: "unpaid", open: "1297.20", linkCurrency: "CHF" });
    expect(d.payments).toEqual([]);
  });

  it("overdue with the days; cancel (typed flag) and uncancel; delete only while unlinked and documentless", async () => {
    const r = await create(julyInvoice({ dueDate: "2026-03-20" }));
    expect(await detail(r.data!.id, "2026-03-27")).toMatchObject({
      status: "overdue",
      daysOverdue: 7,
    });
    const cancelled = await run(owner.caller, (tx) =>
      cancelSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id, "  Sent twice  "),
    );
    expect(cancelled.data).toMatchObject({ cancelled: true, cancelledReason: "Sent twice" });
    expect(await detail(r.data!.id, "2026-03-27")).toMatchObject({
      status: "cancelled",
      open: "0.00",
      editable: false,
    });
    await run(owner.caller, async (tx) => {
      const edit = await updateSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id, {
        note: "x",
      });
      expect(edit.error?.message).toMatch(/cancelled/);
      const row = await importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-31", amount: "-1297.20" },
      ]);
      const pay = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: r.data!.id,
        bankTransactionId: row[0],
      });
      expect(pay.error?.message).toMatch(/is cancelled/);
      const back = await uncancelSupplierInvoice(tx, owner.caller, noopAudit, r.data!.id);
      expect(back.data?.cancelled).toBe(false);
      const del = await deleteSupplierInvoice(
        tx,
        owner.caller,
        realAudit(tx, owner.caller),
        r.data!.id,
      );
      expect(del.data).toEqual({ deleted: true });
    });
    await assertAuditLogged(
      adminPool,
      owner.caller.tenantId,
      "delete",
      "supplier_invoice",
      r.data!.id,
    );
    // the key is never reused
    const next = await create(julyInvoice({ invoiceNumber: "9161" }));
    expect(next.data?.key).toBe("SI213-Acc-02");
  });
});

describe("US3 / US4 — the list, the KPIs, the pickers, the VAT read model", () => {
  it("the list derives status and open per row; the group section; search by number and supplier", async () => {
    const paid = await create(julyInvoice({ invoiceNumber: "9160", dueDate: "2026-04-10" }));
    const soon = await create(julyInvoice({ invoiceNumber: "9161", dueDate: "2026-04-05" }));
    const late = await create(
      julyInvoice({
        partnerId: saas,
        invoiceNumber: "INV-7",
        currency: "EUR",
        dueDate: "2026-03-25",
      }),
    );
    const row = await chfRow("2026-03-31", "-1297.20");
    await run(owner.caller, (tx) =>
      recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: paid.data!.id,
        bankTransactionId: row,
      }),
    );
    const list = await run(owner.caller, (tx) =>
      listSupplierInvoices(tx, Q, { today: "2026-04-01" }),
    );
    expect(list.total).toBe(3);
    const byKey = Object.fromEntries(list.rows.map((r) => [r.key, r]));
    expect(byKey["SI213-Acc-01"]).toMatchObject({
      status: "paid",
      allocated: "1297.20",
      open: "0.00",
      partnerName: "Skattepunkten Office Services AB",
      basLabel: "653 · Redovisningstjänster",
      groupNumber: 213,
    });
    expect(byKey["SI213-Acc-02"]).toMatchObject({ status: "unpaid", open: "1297.20" });
    expect(byKey["SI213-Acc-03"]).toMatchObject({
      status: "overdue",
      daysOverdue: 7,
      partnerName: "OpenAI",
      currency: "EUR",
    });
    expect(list.sums?.open).toBe("2594.40");
    const filtered = await run(owner.caller, (tx) =>
      listSupplierInvoices(
        tx,
        { ...Q, filters: { status: { kind: "in", values: ["overdue"] } } },
        { today: "2026-04-01" },
      ),
    );
    expect(filtered.rows.map((r) => r.id)).toEqual([late.data!.id]);
    const searched = await run(owner.caller, (tx) =>
      listSupplierInvoices(tx, { ...Q, search: "openai" }, { today: "2026-04-01" }),
    );
    expect(searched.rows.map((r) => r.id)).toEqual([late.data!.id]);
    const byNumber = await run(owner.caller, (tx) =>
      listSupplierInvoices(tx, { ...Q, search: "9161" }, { today: "2026-04-01" }),
    );
    expect(byNumber.rows.map((r) => r.id)).toEqual([soon.data!.id]);
    const section = await run(owner.caller, (tx) => listForGroup(tx, groupId));
    expect(section).toHaveLength(3);
  });

  it("one allocated sum (audit 6): a bank row and a journal entry both count — list, detail, payments' open agree", async () => {
    const si = await create(julyInvoice());
    const bankRow = await chfRow("2026-03-20", "-600.00");
    const otherRow = await chfRow("2026-03-21", "-300.00");
    const entry = await adminPool.query(`SELECT id FROM journal_entries WHERE source_id = $1`, [
      otherRow,
    ]);
    const entryId: string = entry.rows[0].id;
    await run(owner.caller, async (tx) => {
      const paid = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: si.data!.id,
        bankTransactionId: bankRow,
      });
      expect(paid.error).toBeUndefined();
      const viaJournal = await linking.createLink(tx, owner.caller, noopAudit, {
        from: { type: "journal_entry", id: entryId },
        to: { type: "supplier_invoice", id: si.data!.id },
        kind: "justifies",
        allocatedAmount: "300.00",
        currency: "CHF",
      });
      expect(viaJournal.error).toBeUndefined();
    });
    const list = await run(owner.caller, (tx) =>
      listSupplierInvoices(tx, Q, { today: "2026-03-25" }),
    );
    const row = list.rows.find((r) => r.id === si.data!.id);
    expect(row).toMatchObject({ status: "partially_paid", allocated: "900.00", open: "397.20" });
    const d = await detail(si.data!.id, "2026-03-25");
    expect(d).toMatchObject({ status: "partially_paid", allocated: "900.00", open: "397.20" });
    // the panel's list adds up to the same sum, the journal entry shown by its label
    expect(d.payments).toHaveLength(2);
    const sum = d.payments.reduce((acc, p) => acc + Number(p.allocated), 0);
    expect(sum.toFixed(2)).toBe(d.allocated);
    const journalPayer = d.payments.find((p) => p.bankTransactionId === null);
    expect(journalPayer).toMatchObject({ allocated: "300.00" });
    expect(journalPayer?.payerLabel).toBeTruthy();
    // the payments service sees the same open: 397.30 is beyond it, 397.20 closes it
    const third = await chfRow("2026-03-24", "-397.30");
    await run(owner.caller, async (tx) => {
      const over = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: si.data!.id,
        bankTransactionId: third,
        amount: "397.30",
      });
      expect(over.error?.message).toMatch(/exceeds the open 397.20/);
      const closes = await recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: si.data!.id,
        bankTransactionId: third,
      });
      expect(closes.data?.allocated).toBe("397.20");
    });
    const after = await detail(si.data!.id, "2026-03-25");
    expect(after).toMatchObject({ status: "paid", allocated: "1297.20", open: "0.00" });
  });

  it("KPIs: open (two), overdue (one), due in 14 days (one), paid this month (one) — SEK", async () => {
    const paid = await create(julyInvoice({ invoiceNumber: "9160", dueDate: "2026-04-10" }));
    await create(julyInvoice({ invoiceNumber: "9161", dueDate: "2026-04-05" }));
    await create(
      julyInvoice({
        partnerId: saas,
        invoiceNumber: "INV-7",
        currency: "EUR",
        dueDate: "2026-03-25",
      }),
    );
    const cancelled = await create(julyInvoice({ invoiceNumber: "9162", dueDate: "2026-04-05" }));
    await run(owner.caller, (tx) =>
      cancelSupplierInvoice(tx, owner.caller, noopAudit, cancelled.data!.id, "dup"),
    );
    const row = await chfRow("2026-03-31", "-1297.20");
    await run(owner.caller, (tx) =>
      recordPayment(tx, owner.caller, noopAudit, {
        invoiceId: paid.data!.id,
        bankTransactionId: row,
      }),
    );
    // EUR 1 297.20 at EUR/SEK 10.76 (03-13) = 13 957.87; CHF the same (EUR/CHF = 1 in the fixture)
    const k = await run(owner.caller, (tx) => kpis(tx, "2026-04-01"));
    expect(k).toEqual({
      openBase: "27915.74",
      openCount: 2,
      overdueBase: "13957.87",
      overdueCount: 1,
      dueSoonBase: "13957.87",
      dueSoonCount: 1,
      paidThisMonthBase: "0.00",
      paidThisMonthCount: 0,
    });
    const march = await run(owner.caller, (tx) => kpis(tx, "2026-03-31"));
    expect(march).toMatchObject({
      paidThisMonthBase: "13957.87",
      paidThisMonthCount: 1,
      overdueCount: 1,
    });
  });

  it("supplier options are the vendors; the VAT read model sums what was stored under a registration", async () => {
    const options = await run(owner.caller, (tx) => supplierOptions(tx));
    expect(options.map((o) => o.name).sort()).toEqual([
      "OpenAI",
      "Skattepunkten Office Services AB",
    ]);
    expect(options.find((o) => o.name === "OpenAI")).toMatchObject({
      defaultCurrency: "EUR",
      paymentTermsDays: null,
    });
    await create(julyInvoice({ invoiceNumber: "9160", invoiceDate: "2026-03-10" }));
    await create(julyInvoice({ invoiceNumber: "9161", invoiceDate: "2026-03-31" }));
    await create(julyInvoice({ invoiceNumber: "9162", invoiceDate: "2026-04-01" }));
    await create(
      julyInvoice({ invoiceNumber: "9163", invoiceDate: "2026-03-12", vatRegistrationId: null }),
    );
    const gone = await create(julyInvoice({ invoiceNumber: "9164", invoiceDate: "2026-03-12" }));
    await run(owner.caller, (tx) =>
      cancelSupplierInvoice(tx, owner.caller, noopAudit, gone.data!.id, "dup"),
    );
    const vat = await run(owner.caller, (tx) =>
      inputVatForPeriod(tx, { registrationId: chReg, from: "2026-03-01", to: "2026-03-31" }),
    );
    // 03-10 at 10.75 → 13 944.90; 03-31 at 10.70 → 13 880.04
    expect(vat).toEqual({
      registrationId: chReg,
      from: "2026-03-01",
      to: "2026-03-31",
      perCurrency: [{ currency: "CHF", vatAmount: "194.40", amountNet: "2400.00", count: 2 }],
      amountBase: "27824.94",
      // 97.20 × 10.75 = 1 044.90 ; 97.20 × 10.70 = 1 040.04
      vatBase: "2084.94",
      count: 2,
    });
  });
});
