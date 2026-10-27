// The fixture month on the real modules (specs/accountant-package/spec.md SC-001 – SC-003, harvest §6): two
// accounts, a transfer pair, a bank fee, an invoice paid short, a supplier invoice from a document, a private
// expense settled (statement rendered) and one without its receipt, an unlinked row — the zip holds exactly the
// expected files, notes.md exactly the expected flags; built twice → identical bytes; roles; the savings CSV.
import { unzipSync } from "fflate";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import { cleanupTestData, createTestDocument, createTestPartner } from "@/kernel/db/test-fixtures";
import type { ListQuery } from "@/kernel/list-query/types";
import type { StorageService } from "@/kernel/storage/storage";
import * as banking from "@/modules/banking";
import * as contracts from "@/modules/contracts";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import * as invoices from "@/modules/invoices";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { collectPeriod } from "./collect";
import { buildPackage } from "./jobs/build-package";
import { notesMd } from "./notes";
import { getBuild, requestBuild } from "./package";
import { monthOf, parsePeriod } from "./period";
import {
  distinctMonthValues,
  listBuilds,
  listMonths,
  livePreview,
  monthDateHierarchy,
  periodFlags,
  periodOverview,
} from "./queries";
import { summaryRows } from "./summary";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/kernel/storage/storage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/kernel/storage/storage")>();
  return { ...mod, createStorageService: () => storage };
});

/** An in-memory blob store: what is uploaded can be downloaded; a test document's path yields "pdf" bytes. */
const blobs = new Map<string, Buffer>();
const storage: StorageService = {
  ensureContainer: vi.fn(async () => {}),
  uploadBlob: vi.fn(async (path: string, bytes: Buffer) => {
    blobs.set(path, Buffer.from(bytes));
    return `https://blob.test/documents/${path}`;
  }),
  downloadBlob: vi.fn(async (path: string) => {
    if (path.endsWith("/missing.pdf")) throw new Error("blob gone");
    return blobs.get(path) ?? Buffer.from(`pdf ${path}`);
  }),
  deleteBlob: vi.fn(async () => {}),
  generateSasUrl: vi.fn(async () => "https://blob.test/sas"),
  generateDownloadUrl: vi.fn(async (path: string) => `https://blob.test/download/${path}`),
} as unknown as StorageService;

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
const TODAY = "2026-07-01";
const NOW = new Date("2026-07-01T09:00:00Z");

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  blobs.clear();
  // 1 CHF = 10.75 SEK for the whole of June
  for (let d = 25; d <= 31; d += 1) await rate(`2026-05-${d}`);
  for (let d = 1; d <= 30; d += 1) await rate(`2026-06-${String(d).padStart(2, "0")}`);
  await rate("2026-07-01");
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

async function rate(date: string) {
  await adminPool.query(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 10.75), ($1, 'EUR/CHF', 1)`,
    [date],
  );
}

type Fixture = {
  invoiceId: string;
  invoiceNumber: string;
  supplierKey: string;
  rows: Record<string, string>;
  settlementNumber: string;
};

/** The fixture month of harvest §6 (a): June 2026 on the owner's accounts. */
async function juneFixture(): Promise<Fixture> {
  const caller = owner.caller;
  const audit = (tx: Parameters<typeof realAudit>[0]) => realAudit(tx, caller);

  // the Swiss client, its contract and the June invoice of 25 000.00 CHF
  const inv = await run(caller, async (tx) => {
    const reg = await settings.createVatRegistration(tx, caller, noopAudit, {
      country: "CH",
      vatNumber: "CHE-000.000.000 TVA",
      rateSchedule: { rates: [8.1] },
    });
    const partner = await partners.createPartner(tx, caller, noopAudit, {
      name: "Vaudoise Assurances",
      shortCode: "VA",
      types: ["client"],
      defaultCurrency: "CHF",
      defaultLanguage: "fr",
    });
    const partnerId = partner.data?.id as string;
    const contract = await contracts.createContract(tx, caller, noopAudit, {
      partnerId,
      name: "BI consulting 2026",
      startDate: "2026-01-01",
      currency: "CHF",
      paymentTerms: "NET_30",
      vatRegistrationId: reg.data?.id,
    });
    const contractId = contract.data?.id as string;
    await contracts.createContractRate(tx, caller, noopAudit, {
      contractId,
      validFrom: "2026-01-01",
      rate: "1250.00",
    });
    const draft = await invoices.createDraft(tx, caller, noopAudit, "2026-06-10", {
      partnerId,
      contractId,
      issueDate: "2026-06-10",
      periodLabel: "2026 May",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
    });
    const id = draft.data?.id as string;
    await invoices.updateDraft(tx, caller, noopAudit, {
      id,
      lines: [
        {
          description: "Consulting Services",
          quantity: "20",
          unitPrice: "1250.00",
          vatRate: "0",
          rateSourceId: draft.data?.lines[0]?.rateSourceId ?? null,
        },
      ],
    });
    const issued = await invoices.issue(tx, caller, audit(tx), new Date("2026-06-10T10:00:00Z"), {
      id,
    });
    if (issued.error) throw new Error(issued.error.message);
    // the PDF the job would render
    const pdf = await documents.storeGeneratedDocument(tx, caller, audit(tx), storage, {
      bytes: Buffer.from("%PDF invoice"),
      businessKey: `InvoiceAF_${issued.data.number}.pdf`,
      fileName: `InvoiceAF_${issued.data.number}.pdf`,
      mimeType: "application/pdf",
      prefixType: "invoice",
    });
    await tx.invoice.update({ where: { id }, data: { pdfDocumentId: pdf.data?.id } });
    return { id, number: issued.data.number as string };
  });

  // the supplier, its invoice from a reviewed document, in a batch group
  const vendor = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
    name: "Skattepunkten Office Services AB",
    types: ["vendor"],
    defaultCurrency: "SEK",
  });
  const supplierDoc = await createTestDocument(adminPool, caller.tenantId, caller.userId, {
    businessKey: "exp_20260601_001",
    fileName: "exp_20260601_001.pdf",
    blobUrl: `https://blob.test/documents/${caller.tenantId}/supplier.pdf`,
    status: "extracted",
  });
  const { supplierKey, expenseIds } = await run(caller, async (tx) => {
    await settings.activateBasCategories(tx, caller, noopAudit, ["653"]);
    await settings.updateBasPreference(tx, caller, noopAudit, "653", { shortCode: "Acc" });
    const trip = await expenses.createGroup(tx, caller, noopAudit, {
      description: "Zürich trip",
      kind: "trip",
    });
    const batch = await expenses.createGroup(tx, caller, noopAudit, {
      description: "2026-06 — June",
      kind: "batch",
    });
    const si = await supplierInvoices.createSupplierInvoice(tx, caller, audit(tx), {
      groupId: batch.data?.id as string,
      partnerId: vendor.id,
      invoiceNumber: "9160",
      invoiceDate: "2026-06-01",
      amountNet: "1000.00",
      vatAmount: "250.00",
      amountTotal: "1250.00",
      basCode: "653",
      documentId: supplierDoc.id,
    });
    if (si.error) throw new Error(si.error.message);
    // two private CHF expenses: the train without its receipt, the hotel from its receipt
    const train = await expenses.createExpense(tx, caller, noopAudit, {
      groupId: trip.data?.id as string,
      date: "2026-06-03",
      description: "Train Zürich",
      basCode: "580",
      amount: "120.00",
      currency: "CHF",
      paymentSourceId: owner.sources.privateCh.id,
    });
    const receipt = await createTestDocument(adminPool, caller.tenantId, caller.userId, {
      businessKey: "exp_20260604_001",
      fileName: "exp_20260604_001.pdf",
      blobUrl: `https://blob.test/documents/${caller.tenantId}/hotel.pdf`,
      status: "extracted",
    });
    const hotel = await expenses.createExpense(tx, caller, noopAudit, {
      groupId: trip.data?.id as string,
      date: "2026-06-04",
      description: "Hotel Zürich",
      basCode: "583",
      amount: "50.00",
      currency: "CHF",
      paymentSourceId: owner.sources.privateCh.id,
      documentId: receipt.id,
    });
    if (train.error || hotel.error) throw new Error("expense");
    return {
      supplierKey: si.data.key,
      expenseIds: { train: train.data.id, hotel: hotel.data.id },
    };
  });

  // the bank rows of June
  const rows = await run(caller, async (tx) => {
    const sek = await importRows(tx, caller, owner.accounts.sek, "SEK", [
      { date: "2026-06-05", amount: "-10750.00", name: "CHANGE CHFSEK", message: "to CHF" },
      { date: "2026-06-12", amount: "-1250.00", name: "SKATTEPUNKTEN", message: "9160" },
      { date: "2026-06-20", amount: "-40.00", name: "Avgift", message: "Månadsavgift" },
      { date: "2026-06-27", amount: "-198.52", name: "OPENAI *CHATGPT", message: "OPENAI" },
      { date: "2026-06-28", amount: "-1290.00", name: "Zikrija", message: "Utlägg juni" },
    ]);
    const chf = await importRows(tx, caller, owner.accounts.chf, "CHF", [
      { date: "2026-06-05", amount: "1000.00", name: "CHANGE CHFSEK", message: "from SEK" },
      { date: "2026-06-15", amount: "24980.00", name: "VAUDOISE ASSURANCES", message: inv.number },
    ]);
    return {
      transferOut: sek[0] as string,
      supplierPayment: sek[1] as string,
      fee: sek[2] as string,
      openai: sek[3] as string,
      refund: sek[4] as string,
      transferIn: chf[0] as string,
      clientPayment: chf[1] as string,
    };
  });

  // link: the client's short payment, the supplier payment, the transfer pair, the fee as no document
  const settlementNumber = await run(caller, async (tx) => {
    const paid = await linking.createLink(tx, caller, audit(tx), {
      from: { type: "bank_transaction", id: rows.clientPayment },
      to: { type: "invoice", id: inv.id },
      kind: "justifies",
      allocatedAmount: "24980.00",
      currency: "CHF",
    });
    if (paid.error) throw new Error(paid.error.message);
    const si = await supplierInvoices.listSupplierInvoices(
      tx,
      { page: 1, pageSize: 10, sort: [], filters: {} },
      { today: TODAY },
    );
    // a supplier invoice's payment is written by its own module (D37, F58)
    const supplier = await supplierInvoices.recordPayment(tx, caller, audit(tx), {
      invoiceId: si.rows[0]?.id as string,
      bankTransactionId: rows.supplierPayment,
      amount: "1250.00",
    });
    if (supplier.error) throw new Error(supplier.error.message);
    const transfer = await banking.acceptTransfer(tx, caller, audit(tx), {
      fromId: rows.transferOut,
      toId: rows.transferIn,
    });
    if (transfer.error) throw new Error(transfer.error.message);
    const feeEntry = (await banking.transactionFacts(tx, [rows.fee])).get(rows.fee);
    await settings.activateBasCategories(tx, caller, noopAudit, ["657"]);
    const fee = await banking.categorise(tx, caller, noopAudit, feeEntry?.id as string, {
      basCode: "657",
      noDocumentNeeded: true,
    });
    if (fee.error) throw new Error(fee.error.message);
    // the refund settles the train (FIFO: 1 290.00 SEK = 120.00 CHF), the hotel stays open
    const proposal = await expenses.proposeSettlement(tx, { bankTransactionId: rows.refund });
    if (proposal.error) throw new Error(proposal.error.message);
    const confirmed = await expenses.confirmSettlement(tx, caller, audit(tx), {
      bankTransactionId: rows.refund,
      paymentSourceId: proposal.data.paymentSourceId as string,
      lines: proposal.data.lines.map((l) => ({
        expenseId: l.expenseId,
        allocatedBase: l.allocatedBase,
      })),
    });
    if (confirmed.error) throw new Error(confirmed.error.message);
    return confirmed.data.number;
  });
  // the statement PDF the job would render
  const settlementId = (await run(caller, (tx) => expenses.listSettlements(tx)))[0]?.id as string;
  await expenses.renderStatement(
    { tenantId: caller.tenantId, userId: caller.userId, settlementId },
    async (path) => Buffer.from(`%PDF ${path}`),
  );
  void expenseIds;
  return { invoiceId: inv.id, invoiceNumber: inv.number, supplierKey, rows, settlementNumber };
}

const build = (period: string, caller: CallerIdentity = owner.caller) =>
  run(caller, (tx) => requestBuild(tx, caller, noopAudit, { period }));

async function buildAndRun(period: string) {
  const requested = await build(period);
  if (requested.error) throw new Error(requested.error.message);
  const buildId = requested.data.id;
  await buildPackage(
    { tenantId: owner.caller.tenantId, userId: owner.caller.userId, buildId },
    { storage, today: TODAY, now: () => NOW },
  );
  const done = await run(owner.caller, (tx) => getBuild(tx, buildId));
  if (!done) throw new Error("build gone");
  const doc = done.documentId
    ? await run(owner.caller, (tx) => documents.documentsByIds(tx, [done.documentId as string]))
    : [];
  const zipPath = [...blobs.keys()].find((k) => k.endsWith(".zip") && blobs.get(k));
  const stored = done.documentId
    ? await run(owner.caller, async (tx) => {
        const readers = await documents.documentReaders(tx, storage, [done.documentId as string]);
        return readers.get(done.documentId as string);
      })
    : undefined;
  const zip = stored ? await stored() : null;
  void zipPath;
  return { build: done, document: doc[0] ?? null, zip };
}

describe("SC-001 — the fixture month", () => {
  it("collects the period: rows, entities, documents, flags — exactly what harvest §6 (a) expects", async () => {
    const f = await juneFixture();
    const data = await run(owner.caller, (tx) => collectPeriod(tx, parsePeriod("2026-06"), TODAY));

    // booking date first, then the file's order (R6); the accepted transfer pair is "no document needed"
    expect(data.bank.map((r) => [r.account, r.bookingDate, r.amount, r.status])).toEqual([
      ["Plusgirokonto SEK", "2026-06-05", "-10750.00", "no_document"],
      ["Plusgirokonto CHF", "2026-06-05", "1000.00", "no_document"],
      ["Plusgirokonto SEK", "2026-06-12", "-1250.00", "linked"],
      ["Plusgirokonto CHF", "2026-06-15", "24980.00", "linked"],
      ["Plusgirokonto SEK", "2026-06-20", "-40.00", "no_document"],
      ["Plusgirokonto SEK", "2026-06-27", "-198.52", "open"],
      ["Plusgirokonto SEK", "2026-06-28", "-1290.00", "linked"],
    ]);
    expect(data.bank[0]?.related).toEqual(["transfer ↔ Plusgirokonto CHF 2026-06-05 1000.00 CHF"]);
    expect(data.bank[2]?.related).toEqual([f.supplierKey]);
    expect(data.bank[6]?.related).toEqual([
      `Reimb_${f.settlementNumber}_2026-06-28.pdf`,
      `settles ${f.settlementNumber}`,
    ]);
    expect(data.bank[3]).toMatchObject({
      related: [f.invoiceNumber],
      allocated: "24980.00",
      delta: "0.00",
      amountBase: "268535.00",
    });

    expect(data.income).toHaveLength(1);
    expect(data.income[0]).toMatchObject({
      number: f.invoiceNumber,
      client: "Vaudoise Assurances",
      total: "25000.00",
      paid: "24980.00",
      remaining: "20.00",
      status: "paid",
      declarationPeriod: "CH 2026/Q2",
      pdfKey: `InvoiceAF_${f.invoiceNumber}.pdf`,
      reason: "issued, paid",
      flags: [],
    });
    expect(data.suppliers[0]).toMatchObject({
      key: f.supplierKey,
      supplier: "Skattepunkten Office Services AB",
      total: "1250.00",
      status: "paid",
      paidVia: ["Plusgirokonto SEK 2026-06-12 -1250.00 SEK"],
      documentKey: `${f.supplierKey}_2026-06-01_Skattepunkten_Office_Services_AB`,
      reason: "dated, paid",
    });
    expect(data.expenses.map((e) => [e.key, e.status, e.documentKey, e.settlement])).toEqual([
      ["Ex213-Rep-01", "to_refund", "Ex213-Rep-01_2026-06-04_", null],
      ["Ex213-Tr-01", "refunded", "MISSING", f.settlementNumber],
    ]);
    expect(data.expenses[1]?.refundDate).toBe("2026-06-28");
    expect(data.settlements.map((s) => [s.number, s.expenses, s.statementKey])).toEqual([
      [f.settlementNumber, ["Ex213-Tr-01"], `Reimb_${f.settlementNumber}_2026-06-28.pdf`],
    ]);

    expect(data.documents.map((d) => `${d.folder}/${d.fileName}`)).toEqual([
      `client-invoices/InvoiceAF_${f.invoiceNumber}.pdf`,
      "expenses/Ex213-Rep-01_2026-06-04_.pdf",
      `expenses/Reimb_${f.settlementNumber}_2026-06-28.pdf`,
      `supplier-invoices/${f.supplierKey}_2026-06-01_Skattepunkten_Office_Services_AB.pdf`,
    ]);

    expect(data.flags).toEqual([
      {
        kind: "unlinked_row",
        entity: "bank_transaction",
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        key: "Plusgirokonto SEK 2026-06-27 -198.52 SEK",
        detail: "OPENAI *CHATGPT",
        // the screen's parts (F71) — notes.md and the Flags sheet print key + detail only
        amount: "-198.52",
        currency: "SEK",
        account: "Plusgirokonto SEK",
        date: "2026-06-27",
      },
      {
        kind: "missing_document",
        entity: "expense",
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        key: "Ex213-Tr-01",
        detail: "Train Zürich",
      },
    ]);
    expect(data.transfers).toEqual([
      {
        date: "2026-06-05",
        from: "Plusgirokonto SEK 2026-06-05 -10750.00 SEK",
        to: "Plusgirokonto CHF 2026-06-05 1000.00 CHF",
        implied: "0.093023",
      },
    ]);
    expect(data.liability).toEqual([
      { source: "Private CH", currency: "CHF", openBase: "537.50", openCount: 1 },
    ]);
    expect(data.vatPeriods).toEqual([
      {
        declarationPeriod: "CH 2026/Q2",
        currency: "CHF",
        count: 1,
        net: "25000.00",
        vat: "0.00",
        total: "25000.00",
      },
    ]);
    // the links sheet names every arrow by business key
    const kinds = data.links.map((l) => `${l.kind} ${l.fromType}→${l.toType}`).sort();
    expect(kinds).toEqual(
      [
        "created_from expense→document",
        "created_from supplier_invoice→document",
        "justifies bank_transaction→document",
        "justifies bank_transaction→invoice",
        "justifies bank_transaction→supplier_invoice",
        "settles bank_transaction→settlement",
        "transfer bank_transaction→bank_transaction",
      ].sort(),
    );
    expect(data.links.every((l) => l.fromKey !== "?" && l.toKey !== "?")).toBe(true);

    const md = notesMd(data);
    expect(md).toContain("## Flags (2)");
    expect(md).toContain("### Missing documents (1)");
    expect(md).toContain("- expense **Ex213-Tr-01** — Train Zürich");
    expect(md).toContain("### Unlinked bank lines (1)");
    expect(md).toContain("- Private CH: 537.50 SEK open over 1 expense");
    expect(summaryRows(data).bank).toHaveLength(7);
  });

  it("the invoice issued in June and paid in July is in both months (D31)", async () => {
    const f = await juneFixture();
    await run(owner.caller, async (tx) => {
      // July: a second client payment of a July invoice is not needed — move the June payment to July
      await linking.removeLink(
        tx,
        owner.caller,
        noopAudit,
        (await linking.getLinksFor(tx, { type: "invoice", id: f.invoiceId })).data?.[0]
          ?.id as string,
      );
      const [julyRow] = await importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-07-03", amount: "25000.00", name: "VAUDOISE", message: f.invoiceNumber },
      ]);
      await rate("2026-07-03");
      await linking.createLink(tx, owner.caller, noopAudit, {
        from: { type: "bank_transaction", id: julyRow as string },
        to: { type: "invoice", id: f.invoiceId },
        kind: "justifies",
        allocatedAmount: "25000.00",
        currency: "CHF",
      });
    });
    const june = await run(owner.caller, (tx) =>
      collectPeriod(tx, parsePeriod("2026-06"), "2026-08-01"),
    );
    const july = await run(owner.caller, (tx) =>
      collectPeriod(tx, parsePeriod("2026-07"), "2026-08-01"),
    );
    expect(june.income.map((i) => [i.number, i.reason])).toEqual([[f.invoiceNumber, "issued"]]);
    expect(july.income.map((i) => [i.number, i.reason])).toEqual([[f.invoiceNumber, "paid"]]);
    expect(july.documents.map((d) => d.fileName)).toEqual([`InvoiceAF_${f.invoiceNumber}.pdf`]);
  });
});

describe("the build job (FR-005, SC-001, SC-002)", () => {
  it("zips the fixed layout, stores Package_2026-06.zip, marks the build built with counts and notes", async () => {
    const f = await juneFixture();
    const { build, document, zip } = await buildAndRun("2026-06");
    expect(build).toMatchObject({
      status: "built",
      version: 1,
      businessKey: "Package_2026-06.zip",
      flags: 2,
      counts: {
        bankRows: 7,
        invoices: 1,
        supplierInvoices: 1,
        expenses: 2,
        settlements: 1,
        documents: 4,
      },
      error: null,
    });
    expect(build.builtAt?.toISOString()).toBe(NOW.toISOString());
    expect(build.notes).toContain("## Flags (2)");
    expect(document).toMatchObject({
      businessKey: "Package_2026-06.zip",
      mimeType: "application/zip",
      status: "generated",
      documentType: "financial",
    });
    const files = Object.keys(unzipSync(zip as Buffer)).sort();
    expect(files).toEqual([
      "2026-06/bank-statements/CHF.csv",
      "2026-06/bank-statements/SEK.csv",
      `2026-06/client-invoices/InvoiceAF_${f.invoiceNumber}.pdf`,
      "2026-06/expenses/Ex213-Rep-01_2026-06-04_.pdf",
      `2026-06/expenses/Reimb_${f.settlementNumber}_2026-06-28.pdf`,
      "2026-06/notes.md",
      "2026-06/summary.xlsx",
      `2026-06/supplier-invoices/${f.supplierKey}_2026-06-01_Skattepunkten_Office_Services_AB.pdf`,
    ]);
    const entries = unzipSync(zip as Buffer);
    const sek = Buffer.from(entries["2026-06/bank-statements/SEK.csv"] as Uint8Array).toString(
      "utf8",
    );
    expect(sek.split("\r\n").filter(Boolean)).toHaveLength(6); // header + 5 rows
    expect(sek).toContain("2026-06-27;-198,52;SEK;;;OPENAI *CHATGPT;;OPENAI;;;Plusgirokonto SEK;");
    expect(
      Buffer.from(
        entries[`2026-06/client-invoices/InvoiceAF_${f.invoiceNumber}.pdf`] as Uint8Array,
      ).toString(),
    ).toBe("%PDF invoice");
    expect(Buffer.from(entries["2026-06/notes.md"] as Uint8Array).toString()).toBe(build.notes);
  });

  it("built twice → identical bytes, version 2 as Package_2026-06_v2.zip, the first version kept (R6)", async () => {
    await juneFixture();
    const first = await buildAndRun("2026-06");
    const second = await buildAndRun("2026-06");
    expect(second.build).toMatchObject({
      status: "built",
      version: 2,
      businessKey: "Package_2026-06_v2.zip",
    });
    expect(Buffer.compare(first.zip as Buffer, second.zip as Buffer)).toBe(0);
    const builds = await run(owner.caller, (tx) => listBuilds(tx));
    expect(builds.map((b) => [b.version, b.status])).toEqual([
      [2, "built"],
      [1, "built"],
    ]);
    expect([...blobs.keys()].filter((k) => k.endsWith(".zip"))).toHaveLength(2);
  });

  it("a document the store cannot deliver fails the build with the reason and stores nothing (R8)", async () => {
    await juneFixture();
    await run(owner.caller, (tx) =>
      tx.document.updateMany({
        where: { businessKey: { startsWith: "InvoiceAF_" } },
        data: { blobUrl: `https://blob.test/documents/${owner.caller.tenantId}/missing.pdf` },
      }),
    );
    const { build, document } = await buildAndRun("2026-06");
    expect(build.status).toBe("failed");
    expect(build.error).toMatch(/blob gone/);
    expect(document).toBeNull();
    expect([...blobs.keys()].some((k) => k.endsWith(".zip"))).toBe(false);
    // a second request is allowed once the first failed
    expect((await build2()).error).toBeUndefined();
  });

  it("refuses a second request while one is running; the job skips a build that is gone", async () => {
    await juneFixture();
    const first = await build("2026-06");
    expect(first.data?.status).toBe("queued");
    const again = await build("2026-06");
    expect(again.error?.message).toMatch(/already running/);
    expect((await build("2026-13")).error?.code).toBe("VALIDATION_ERROR");
    await buildPackage(
      {
        tenantId: owner.caller.tenantId,
        userId: owner.caller.userId,
        buildId: "00000000-0000-0000-0000-000000000000",
      },
      { storage, today: TODAY, now: () => NOW },
    );
  });
});

const build2 = () => build("2026-06");

describe("F83 — periodFlags: the flags without the package (the dashboard's item)", () => {
  const both = (period: string, today: string) =>
    run(owner.caller, async (tx) => ({
      preview: (await livePreview(tx, period, today)).flags,
      flags: await periodFlags(tx, period, today),
    }));

  it("the fixture month: the same flags as livePreview, in the same order", async () => {
    await juneFixture();
    const { preview, flags } = await both("2026-06", TODAY);
    expect(preview.length).toBeGreaterThan(0);
    expect(flags).toEqual(preview);
    // every kind the month raises comes through the narrow read too
    expect(new Set(flags.map((f) => f.kind))).toEqual(new Set(preview.map((f) => f.kind)));
  });

  it("what a period row justifies from another month is found (the date window widens to it); an empty month has none", async () => {
    const f = await juneFixture();
    const caller = owner.caller;
    await rate("2026-07-03");
    await run(caller, async (tx) => {
      const vendor = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
        name: "Invented Hosting AB",
        types: ["vendor"],
        defaultCurrency: "SEK",
      });
      const batch = await expenses.createGroup(tx, caller, noopAudit, {
        description: "2026-04 — April",
        kind: "batch",
      });
      // a May supplier invoice without its document, an April card expense without its receipt
      const si = await supplierInvoices.createSupplierInvoice(tx, caller, noopAudit, {
        groupId: batch.data?.id as string,
        partnerId: vendor.id,
        invoiceNumber: "H-77",
        invoiceDate: "2026-05-10",
        amountNet: "400.00",
        vatAmount: "100.00",
        amountTotal: "500.00",
        basCode: "653",
      });
      if (si.error) throw new Error(si.error.message);
      const card = await expenses.createExpense(tx, caller, noopAudit, {
        groupId: batch.data?.id as string,
        date: "2026-04-14",
        description: "Invented software",
        basCode: "580",
        amount: "150.00",
        currency: "SEK",
        paymentSourceId: owner.sources.afSek.id,
      });
      if (card.error) throw new Error(card.error.message);
      // the June client payment moves out: July's ten francs leave the June invoice open
      await linking.removeLink(
        tx,
        caller,
        noopAudit,
        (await linking.getLinksFor(tx, { type: "invoice", id: f.invoiceId })).data?.[0]
          ?.id as string,
      );
      // July pays all three: the May invoice, the April expense, ten francs of the June client invoice
      const [hosting, software] = await importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-02", amount: "-500.00", name: "INVENTED HOSTING", message: "H-77" },
        { date: "2026-07-03", amount: "-150.00", name: "INVENTED SOFTWARE" },
      ]);
      const [client] = await importRows(tx, caller, owner.accounts.chf, "CHF", [
        { date: "2026-07-03", amount: "10.00", name: "VAUDOISE", message: f.invoiceNumber },
      ]);
      const paid = await supplierInvoices.recordPayment(tx, caller, noopAudit, {
        invoiceId: si.data.id,
        bankTransactionId: hosting as string,
      });
      if (paid.error) throw new Error(paid.error.message);
      const attached = await expenses.attachBankTransaction(tx, caller, noopAudit, {
        expenseId: card.data.id,
        bankTransactionId: software as string,
      });
      if (attached.error) throw new Error(attached.error.message);
      const short = await linking.createLink(tx, caller, noopAudit, {
        from: { type: "bank_transaction", id: client as string },
        to: { type: "invoice", id: f.invoiceId },
        kind: "justifies",
        allocatedAmount: "10.00",
        currency: "CHF",
      });
      if (short.error) throw new Error(short.error.message);
    });
    const july = await both("2026-07", "2026-08-01");
    expect(july.flags).toEqual(july.preview);
    // dated in April, May and June — selected only because a July row justifies them
    expect(july.flags.map((x) => [x.kind, x.entity])).toEqual(
      expect.arrayContaining([
        ["unpaid_invoice", "invoice"],
        ["missing_document", "supplier_invoice"],
        ["missing_document", "expense"],
      ]),
    );
    const august = await both("2026-08", "2026-09-01");
    expect(august).toEqual({ preview: [], flags: [] });
  });
});

describe("the savings export (D31) and the year package", () => {
  it("the savings CSV joins the package of the month it was imported in, not of its booking dates", async () => {
    await juneFixture();
    await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sav, "SEK", [
        { date: "2026-03-31", amount: "12.50", name: "Ränta" },
        { date: "2026-06-30", amount: "13.00", name: "Ränta" },
      ]),
    );
    const importMonth = monthOf(new Date().toISOString());
    const june = await run(owner.caller, (tx) => collectPeriod(tx, parsePeriod("2026-06"), TODAY));
    const current = await run(owner.caller, (tx) =>
      collectPeriod(tx, parsePeriod(importMonth), TODAY),
    );
    const savings = (d: typeof june) => d.bank.filter((r) => r.accountRole === "savings").length;
    if (importMonth === "2026-06") {
      expect(savings(june)).toBe(2);
    } else {
      expect(savings(june)).toBe(0);
      expect(savings(current)).toBe(2);
    }
    // savings rows never raise an "unlinked" flag
    expect(current.flags.filter((f) => f.key.includes("Sparkonto"))).toEqual([]);
  });

  it("the year: twelve monthly folders, the savings CSV of the year at the root, the yearly summary", async () => {
    const f = await juneFixture();
    await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sav, "SEK", [
        { date: "2026-03-31", amount: "12.50", name: "Ränta" },
        { date: "2025-12-31", amount: "9.00", name: "Ränta" },
      ]),
    );
    const { build, zip } = await buildAndRun("2026");
    expect(build).toMatchObject({ status: "built", businessKey: "Package_2026.zip" });
    const files = Object.keys(unzipSync(zip as Buffer)).sort();
    expect(files.filter((x) => x.endsWith("/notes.md"))).toHaveLength(13);
    expect(files).toContain("2026/2026-06/summary.xlsx");
    expect(files).toContain(`2026/2026-06/client-invoices/InvoiceAF_${f.invoiceNumber}.pdf`);
    expect(files).toContain("2026/bank-statements/savings.csv");
    expect(files).toContain("2026/summary.xlsx");
    const entries = unzipSync(zip as Buffer);
    const savings = Buffer.from(
      entries["2026/bank-statements/savings.csv"] as Uint8Array,
    ).toString();
    expect(savings).toContain("2026-03-31;12,50");
    expect(savings).not.toContain("2025-12-31");
    expect(build.counts.bankRows).toBe(8);
  });
});

describe("SC-003 — roles; the page's reads", () => {
  it("the owner builds and downloads, the accountant downloads only, the editor neither", async () => {
    await juneFixture();
    const accountant: CallerIdentity = { ...owner.caller, role: "accountant" };
    const editor: CallerIdentity = { ...owner.caller, role: "editor" };
    expect((await build("2026-06", accountant)).error?.code).toBe("FORBIDDEN");
    expect((await build("2026-06", editor)).error?.code).toBe("FORBIDDEN");
    expect(can(accountant, "read", "accountant_package")).toBe(true);
    expect(can(editor, "read", "accountant_package")).toBe(false);
    const { build: done } = await buildAndRun("2026-06");
    const url = await run(accountant, (tx) =>
      documents.getDocumentDownloadUrl(tx, accountant, storage, done.documentId as string),
    );
    // F106: the authenticated route, never a storage URL
    expect(url.data?.downloadUrl).toBe(`/api/documents/${done.documentId}/file?download=1`);
  });

  it("the overview lists the months with live counts and flags, the year, and every build; the preview is the notes", async () => {
    await juneFixture();
    const { build: done } = await buildAndRun("2026-06");
    const overview = await run(owner.caller, (tx) => periodOverview(tx, TODAY));
    expect(overview.map((o) => o.period)).toEqual(["2026-07", "2026-06", "2026"]);
    const june = overview.find((o) => o.period === "2026-06");
    expect(june).toMatchObject({ kind: "month", flags: 2, counts: { bankRows: 7, documents: 4 } });
    expect(june?.builds.map((b) => b.id)).toEqual([done.id]);
    expect(overview[0]).toMatchObject({ period: "2026-07", flags: 0, counts: { bankRows: 0 } });
    expect(overview[2]).toMatchObject({ kind: "year", flags: 2, counts: { bankRows: 7 } });
    const preview = await run(owner.caller, (tx) => livePreview(tx, "2026-06", TODAY));
    expect(preview.flags).toHaveLength(2);
    expect(preview.notes).toBe(done.notes);
    expect(preview.files).toHaveLength(4);
  });

  it("the months' table (F71): the derived state, the Month quick filter, the state filter and its values", async () => {
    await juneFixture();
    const overview = await run(owner.caller, (tx) => periodOverview(tx, TODAY));
    const q = (filters: ListQuery["filters"] = {}): ListQuery => ({
      page: 1,
      pageSize: 25,
      sort: [],
      filters,
    });
    // newest first, years kept out of the months' table; June has two flags, July nothing at all
    const all = listMonths(overview, q());
    expect(all.rows.map((r) => [r.period, r.month, r.state, r.flags])).toEqual([
      ["2026-07", "2026-07-01", "empty", 0],
      ["2026-06", "2026-06-01", "flagged", 2],
    ]);
    expect(all.total).toBe(2);
    // Month: June 2026 — the kit's date filter on the period's first day
    expect(
      listMonths(overview, q({ month: { kind: "dates", months: ["2026-06"] } })).rows.map(
        (r) => r.period,
      ),
    ).toEqual(["2026-06"]);
    expect(
      listMonths(overview, q({ state: { kind: "in", values: ["empty"] } })).rows.map(
        (r) => r.period,
      ),
    ).toEqual(["2026-07"]);
    expect(
      distinctMonthValues(overview, "state", q())
        .map((v) => v.value)
        .sort(),
    ).toEqual(["empty", "flagged"]);
    expect(monthDateHierarchy(overview, "month", q()).years.map((y) => y.year)).toEqual([2026]);
    // a build turns June's state while it runs; built and unflagged it would be done
    const { build } = await buildAndRun("2026-06");
    const after = await run(owner.caller, (tx) => periodOverview(tx, TODAY));
    const june = listMonths(after, q()).rows.find((r) => r.period === "2026-06");
    expect(june).toMatchObject({ state: "flagged", packageKey: build.businessKey });
  });
});
