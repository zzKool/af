// The overview on the real modules (feature inventory §3.14): an open bank row, an overdue client invoice, a
// private expense, a supplier invoice overdue, a CH registration with last quarter undeclared → the action items
// with their counts and pages, the pulse, the briefing from the audit trail; the accountant's subset.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { cleanupTestData, createTestDocument, createTestPartner } from "@/kernel/db/test-fixtures";
import * as contracts from "@/modules/contracts";
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
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { dashboardOverview, daysBefore, previousMonth, previousQuarter } from "./overview";

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
  // a rate on every day of the window so the only gap flagged is the one we leave (≥ 3 weekdays, holidays allowed)
  for (
    let d = new Date("2026-06-01T00:00:00Z");
    d <= new Date("2026-07-15T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10);
    if (["2026-07-07", "2026-07-08", "2026-07-09"].includes(date)) continue; // three weekdays without a rate = a gap
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 10.75), ($1, 'EUR/CHF', 1)`,
      [date],
    );
  }
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

describe("pure helpers", () => {
  it("previous month, previous quarter, days before", () => {
    expect(previousMonth("2026-07-15")).toBe("2026-06");
    expect(previousMonth("2026-01-03")).toBe("2025-12");
    expect(previousQuarter("2026-07-15")).toBe("CH 2026/Q2");
    expect(previousQuarter("2026-02-01")).toBe("CH 2025/Q4");
    expect(daysBefore("2026-07-15", 30)).toBe("2026-06-15");
  });
});

async function world() {
  const caller = owner.caller;
  await run(caller, async (tx) => {
    // a CH registration, a Swiss client, an invoice issued in May, due in June → overdue in July
    const reg = await settings.createVatRegistration(tx, caller, noopAudit, {
      country: "CH",
      vatNumber: "CHE-123.456.789 TVA",
      rateSchedule: { rates: [8.1] },
    });
    const partner = await partners.createPartner(tx, caller, noopAudit, {
      name: "Vaudoise Assurances",
      shortCode: "VA",
      types: ["client"],
      defaultCurrency: "CHF",
      defaultLanguage: "fr",
      address: { country: "CH" },
    });
    const partnerId = partner.data?.id as string;
    const contract = await contracts.createContract(tx, caller, noopAudit, {
      partnerId,
      name: "BI 2026",
      startDate: "2026-01-01",
      currency: "CHF",
      paymentTerms: "NET_30",
      vatRegistrationId: reg.data?.id,
    });
    const contractId = contract.data?.id as string;
    await contracts.createContractRate(tx, caller, noopAudit, {
      contractId,
      validFrom: "2026-01-01",
      rate: "1000.00",
    });
    const draft = await invoices.createDraft(tx, caller, noopAudit, "2026-05-10", {
      partnerId,
      contractId,
      issueDate: "2026-05-10",
      periodLabel: "2026 April",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });
    const line = draft.data?.lines[0];
    await invoices.updateDraft(tx, caller, noopAudit, {
      id: draft.data?.id as string,
      lines: [
        {
          description: "Consulting",
          quantity: "10",
          unitPrice: "1000.00",
          vatRate: line?.vatRate ?? "0",
          rateSourceId: line?.rateSourceId ?? null,
        },
      ],
    });
    const issued = await invoices.issue(
      tx,
      caller,
      realAudit(tx, caller),
      new Date("2026-05-10T10:00:00Z"),
      {
        id: draft.data?.id as string,
      },
    );
    if (issued.error) throw new Error(issued.error.message);
    // two SEK rows of June: an unlinked card purchase and a bank fee categorised "no document"
    await importRows(tx, caller, owner.accounts.sek, "SEK", [
      { date: "2026-06-27", amount: "-198.52", name: "OPENAI *CHATGPT" },
    ]);
    // a private expense without receipt, awaiting its refund
    const trip = await expenses.createGroup(tx, caller, noopAudit, {
      description: "Zürich",
      kind: "trip",
    });
    const e = await expenses.createExpense(tx, caller, noopAudit, {
      groupId: trip.data?.id as string,
      date: "2026-06-03",
      description: "Train",
      basCode: "580",
      amount: "120.00",
      currency: "CHF",
      paymentSourceId: owner.sources.privateCh.id,
    });
    if (e.error) throw new Error(e.error.message);
  });
  // a supplier invoice overdue since June
  const vendor = await createTestPartner(adminPool, owner.caller.tenantId, owner.caller.userId, {
    name: "Skattepunkten",
    types: ["vendor"],
    defaultCurrency: "SEK",
  });
  await run(owner.caller, async (tx) => {
    await settings.activateBasCategories(tx, owner.caller, noopAudit, ["653"]);
    await settings.updateBasPreference(tx, owner.caller, noopAudit, "653", { shortCode: "Acc" });
    const batch = await expenses.createGroup(tx, owner.caller, noopAudit, {
      description: "2026-06",
      kind: "batch",
    });
    const si = await supplierInvoices.createSupplierInvoice(tx, owner.caller, noopAudit, {
      groupId: batch.data?.id as string,
      partnerId: vendor.id,
      invoiceNumber: "9160",
      invoiceDate: "2026-06-01",
      dueDate: "2026-06-30",
      amountNet: "1000.00",
      vatAmount: "250.00",
      amountTotal: "1250.00",
      basCode: "653",
    });
    if (si.error) throw new Error(si.error.message);
  });
}

describe("the owner's dashboard", () => {
  it("lists what there is to do, with the figures, pages and priorities; the pulse; the briefing", async () => {
    await world();
    const since = new Date("2026-01-01T00:00:00Z");
    const o = await run(owner.caller, (tx) => dashboardOverview(tx, owner.caller, TODAY, since));
    const byKind = Object.fromEntries(o.items.map((i) => [i.kind, i]));
    expect(byKind.rows_to_justify).toMatchObject({
      count: 1,
      priority: "high",
      href: "/banking/inbox",
    });
    expect(byKind.supplier_invoices_overdue).toMatchObject({
      count: 1,
      priority: "high",
      amount: { value: "1250.00", currency: "SEK" },
    });
    expect(byKind.invoices_overdue).toMatchObject({ count: 1, priority: "medium" });
    expect(byKind.owner_liability).toMatchObject({
      count: 1,
      amount: { value: "1290.00", currency: "SEK" },
    });
    expect(byKind.receipts_missing).toMatchObject({ count: 1, priority: "low" });
    expect(byKind.rate_gaps).toMatchObject({ count: 1, href: "/settings/rates" });
    expect(byKind.package_not_built).toMatchObject({
      period: "2026-06",
      priority: "medium",
      href: "/package",
    });
    expect(byKind.package_not_built?.count).toBeGreaterThanOrEqual(1);
    expect(byKind.vat_not_declared).toMatchObject({
      period: "CH 2026/Q2",
      href: "/exports?period=CH%202026%2FQ2",
    });
    expect(byKind.documents_to_review).toBeUndefined();
    // priorities first, then the order of discovery
    const priorities = o.items.map((i) => i.priority);
    expect(priorities).toEqual(
      [...priorities].sort(
        (a, b) => ({ high: 0, medium: 1, low: 2 })[a] - { high: 0, medium: 1, low: 2 }[b],
      ),
    );

    const pulse = Object.fromEntries(
      o.pulse.map((m) => [m.kind === "balance" ? `balance:${m.label}` : m.kind, m]),
    );
    expect(pulse["balance:Plusgirokonto SEK"]).toMatchObject({ currency: "SEK", href: "/banking" });
    expect(pulse["balance:Plusgirokonto CHF"]).toBeDefined();
    expect(pulse["balance:Sparkonto"]).toBeUndefined();
    // 10 000 + 8.1 % Swiss VAT
    expect(pulse.receivables).toMatchObject({ value: "10810.00", currency: "CHF", hint: "1" });
    expect(pulse.payables).toMatchObject({ value: "1250.00", currency: "SEK", hint: "1" });
    expect(pulse.liability).toMatchObject({ value: "1290.00", currency: "SEK", hint: "1" });
    expect(pulse.invoicedYear).toMatchObject({ value: "116207.50", currency: "SEK", hint: "2026" });

    expect(o.briefing.since).toBe(since.toISOString());
    const lines = Object.fromEntries(
      o.briefing.lines.map((l) => [`${l.entityType}:${l.action}`, l.count]),
    );
    expect(lines["invoice:update"] ?? lines["invoice:create"]).toBeGreaterThanOrEqual(1);
    expect(lines["bank_transaction:create"]).toBe(1);
  });

  it("the accountant sees the pulse, the month-end and the quarter, none of the owner's work items", async () => {
    await world();
    const accountant: CallerIdentity = { ...owner.caller, role: "accountant" };
    const o = await run(owner.caller, (tx) => dashboardOverview(tx, accountant, TODAY, null));
    expect(o.items.map((i) => i.kind).sort()).toEqual(["package_not_built", "vat_not_declared"]);
    expect(o.pulse.length).toBeGreaterThan(3);
    expect(o.briefing).toEqual({ since: null, lines: [] });
  });

  it("documents to review = the inbox's pending + ready, and the item opens the inbox (SC-005, FR-024)", async () => {
    const { tenantId, userId } = owner.caller;
    await createTestDocument(adminPool, tenantId, userId, { status: "uploaded" });
    await createTestDocument(adminPool, tenantId, userId, { status: "extracted" });
    const filed = await createTestDocument(adminPool, tenantId, userId, { status: "extracted" });
    await adminPool.query(`UPDATE documents SET reviewed_at = now() WHERE id = $1`, [filed.id]);
    const parked = await createTestDocument(adminPool, tenantId, userId, { status: "ocr_failed" });
    await adminPool.query(`UPDATE documents SET archived_at = now() WHERE id = $1`, [parked.id]);
    const o = await run(owner.caller, (tx) => dashboardOverview(tx, owner.caller, TODAY, null));
    expect(o.items.find((i) => i.kind === "documents_to_review")).toMatchObject({
      count: 2,
      href: "/documents/inbox",
    });
  });

  it("an empty tenant: nothing but last month's package (and the ECB gap, which is global), the pulse at zero", async () => {
    const o = await run(owner.caller, (tx) => dashboardOverview(tx, owner.caller, TODAY, null));
    expect(o.items.map((i) => i.kind)).toEqual(["package_not_built", "rate_gaps"]);
    expect(o.items[0]?.count).toBe(0);
    expect(o.pulse.find((m) => m.kind === "payables")?.value).toBe("0.00");
  });
});
