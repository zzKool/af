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
import * as rates from "@/modules/rates";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { dashboardOverview, previousMonth, previousQuarter } from "./overview";

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
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 10.75), ($1, 'EUR/CHF', 1), ($1, 'EUR/USD', 1.1)`,
      [date],
    );
  }
  // the Friday before the CHF invoice issued Sun 05-10 (a fallback is capped at 4 days, F60)
  await adminPool.query(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ('2026-05-08', 'EUR/SEK', 10.75), ('2026-05-08', 'EUR/CHF', 1)`,
  );
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

describe("pure helpers", () => {
  it("previous month, previous quarter", () => {
    expect(previousMonth("2026-07-15")).toBe("2026-06");
    expect(previousMonth("2026-01-03")).toBe("2025-12");
    expect(previousQuarter("2026-07-15")).toBe("CH 2026/Q2");
    expect(previousQuarter("2026-02-01")).toBe("CH 2025/Q4");
    expect(previousQuarter("2026-04-01")).toBe("CH 2026/Q1");
    expect(previousQuarter("2026-12-31")).toBe("CH 2026/Q3");
  });
});

async function world(): Promise<{ registrationId: string; partnerId: string; contractId: string }> {
  const caller = owner.caller;
  const ids = await run(caller, async (tx) => {
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
    return { registrationId: reg.data?.id as string, partnerId, contractId };
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
  return ids;
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
    // ECB days without a rate: 07-07 … 07-09, missing in SEK and CHF alike, counted once each
    expect(byKind.rate_gaps).toMatchObject({ count: 3, href: "/settings/rates" });
    expect(byKind.package_not_built).toMatchObject({
      period: "2026-06",
      priority: "medium",
      href: "/package",
    });
    expect(byKind.package_not_built?.count).toBeGreaterThanOrEqual(1);
    expect(byKind.vat_not_declared).toMatchObject({
      period: "CH 2026/Q2",
      href: expect.stringMatching(/^\/exports\?period=CH%202026%2FQ2&registration=[0-9a-f-]{36}$/),
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

  it("the receivables hint counts the open invoices only — a quote sent to the same client is no claim (F57)", async () => {
    const { partnerId, contractId } = await world();
    await run(owner.caller, async (tx) => {
      const quote = await invoices.createDraft(tx, owner.caller, noopAudit, "2026-07-01", {
        type: "quote",
        partnerId,
        contractId,
        issueDate: "2026-07-01",
        periodLabel: "2026 Q3",
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
      });
      const id = quote.data?.id as string;
      const line = quote.data?.lines[0];
      await invoices.updateDraft(tx, owner.caller, noopAudit, {
        id,
        lines: [
          {
            description: "Consulting",
            quantity: "60",
            unitPrice: "1000.00",
            vatRate: line?.vatRate ?? "0",
            rateSourceId: line?.rateSourceId ?? null,
          },
        ],
      });
      const issued = await invoices.issue(
        tx,
        owner.caller,
        noopAudit,
        new Date("2026-07-01T10:00:00Z"),
        { id },
      );
      if (issued.error) throw new Error(issued.error.message);
      const sent = await invoices.markSent(
        tx,
        owner.caller,
        noopAudit,
        new Date("2026-07-02T10:00:00Z"),
        id,
      );
      if (sent.error) throw new Error(sent.error.message);
    });
    const o = await run(owner.caller, (tx) => dashboardOverview(tx, owner.caller, TODAY, null));
    // the CHF figure is the one invoice; the hint says one open invoice, not two documents
    expect(o.pulse.find((m) => m.kind === "receivables")).toMatchObject({
      value: "10810.00",
      currency: "CHF",
      hint: "1",
    });
  });

  it("the quarter is declared per CH registration: a declaration shows on its own registration only (F56)", async () => {
    const { registrationId: declaredReg } = await world();
    const other = await run(owner.caller, (tx) =>
      settings.createVatRegistration(tx, owner.caller, noopAudit, {
        country: "CH",
        vatNumber: "CHE-987.654.321 MWST",
        rateSchedule: { rates: [8.1] },
      }),
    );
    const otherReg = other.data?.id as string;
    // CH 2026/Q2 declared (not yet paid) on the first registration only
    await adminPool.query(
      `INSERT INTO swiss_vat_declarations (tenant_id, vat_registration_id, period, declared_at, created_by, updated_at)
       VALUES ($1, $2, 'CH 2026/Q2', '2026-07-10', $3, now())`,
      [owner.caller.tenantId, declaredReg, owner.caller.userId],
    );
    const o = await run(owner.caller, (tx) => dashboardOverview(tx, owner.caller, TODAY, null));
    const vat = o.items.filter((i) => i.kind === "vat_not_declared" || i.kind === "vat_not_paid");
    expect(vat).toEqual([
      expect.objectContaining({
        id: `vat:${otherReg}`,
        kind: "vat_not_declared",
        period: "CH 2026/Q2",
        href: `/exports?period=CH%202026%2FQ2&registration=${otherReg}`,
      }),
      expect.objectContaining({
        id: `vat-paid:${declaredReg}`,
        kind: "vat_not_paid",
        href: `/exports?period=CH%202026%2FQ2&registration=${declaredReg}`,
      }),
    ]);
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

  it("a CHF trailing gap shows while SEK is current — the day before getRate refuses, and the day it does (F81)", async () => {
    await adminPool.query("TRUNCATE ecb_rates");
    for (
      let d = new Date("2026-06-01T00:00:00Z");
      d <= new Date("2026-07-15T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const date = d.toISOString().slice(0, 10);
      await adminPool.query(
        `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 10.75), ($1, 'EUR/USD', 1.1)`,
        [date],
      );
      // CHF: no sync after Fri 07-10
      if (date <= "2026-07-10")
        await adminPool.query(
          `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/CHF', 1)`,
          [date],
        );
    }
    const db = {
      $queryRawUnsafe: (q: string, ...a: unknown[]) => adminPool.query(q, a).then((r) => r.rows),
    };
    const rateItem = async (today: string) =>
      (
        await run(owner.caller, (tx) => dashboardOverview(tx, owner.caller, today, null))
      ).items.find((i) => i.kind === "rate_gaps");

    // Tue 07-14: Friday's CHF rate is 4 days old — still borrowed today, refused tomorrow; Monday is missing
    expect(await rateItem("2026-07-14")).toMatchObject({ count: 1, href: "/settings/rates" });
    expect((await rates.getRate(db, "2026-07-14", "EUR/CHF"))?.actualDate).toBe("2026-07-10");
    // Wed 07-15: refused — the item stands, with Monday and Tuesday
    expect(await rateItem(TODAY)).toMatchObject({ count: 2 });
    expect(await rates.getRate(db, TODAY, "EUR/CHF")).toBeNull();
    expect(await rates.rateToBase(db, TODAY, "CHF", "SEK")).toBeNull();
  });

  it("an empty tenant: nothing but last month's package (and the ECB gap, which is global), the pulse at zero", async () => {
    const o = await run(owner.caller, (tx) => dashboardOverview(tx, owner.caller, TODAY, null));
    expect(o.items.map((i) => i.kind)).toEqual(["package_not_built", "rate_gaps"]);
    expect(o.items[0]?.count).toBe(0);
    expect(o.pulse.find((m) => m.kind === "payables")?.value).toBe("0.00");
  });
});
