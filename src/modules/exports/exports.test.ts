// The return on the real modules (specs/exports/spec.md SC-002, SC-003): a Swiss client's CHF invoice, a German
// client's invoice (export line), a credit note, a CH supplier invoice and a CH receipt → the quarter's figures,
// the drill-down; the declaration record (manual refs, declare → frozen + derived "declared", paid with the
// vat_payment expense, the undo paths, roles); the period list.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import * as contracts from "@/modules/contracts";
import * as expenses from "@/modules/expenses";
import {
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
import { declare, markPaid, saveManual, undeclare, unmarkPaid } from "./declarations";
import { chRegistrations, declaredOn, swissVatPeriods, swissVatReturn } from "./queries";

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
const PERIOD = "CH 2026/Q2";

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  for (const date of [
    "2026-05-10",
    "2026-05-11",
    "2026-05-12",
    "2026-06-01",
    "2026-06-15",
    "2026-07-15",
  ]) {
    // 1 CHF = 10.75 SEK; 1 EUR = 0.93 CHF → EUR/CHF 0.93, EUR/SEK 10.00
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 10.00), ($1, 'EUR/CHF', 0.93)`,
      [date],
    );
  }
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

type Fixture = {
  regId: string;
  swissId: string;
  germanId: string;
  creditId: string;
  chExpenseId: string;
};

async function client(
  caller: CallerIdentity,
  tx: Parameters<typeof invoices.createDraft>[0],
  name: string,
  shortCode: string,
  country: string,
  regId: string,
  currency: "CHF" | "EUR" = "CHF",
) {
  const partner = await partners.createPartner(tx, caller, noopAudit, {
    name,
    shortCode,
    types: ["client"],
    defaultCurrency: currency,
    defaultLanguage: "fr",
    address: { country },
  });
  const partnerId = partner.data?.id as string;
  const contract = await contracts.createContract(tx, caller, noopAudit, {
    partnerId,
    name: `${name} 2026`,
    startDate: "2026-01-01",
    currency,
    paymentTerms: "NET_30",
    vatRegistrationId: regId,
  });
  const contractId = contract.data?.id as string;
  await contracts.createContractRate(tx, caller, noopAudit, {
    contractId,
    validFrom: "2026-01-01",
    rate: "1000.00",
  });
  return { partnerId, contractId };
}

async function issued(
  caller: CallerIdentity,
  tx: Parameters<typeof invoices.createDraft>[0],
  partnerId: string,
  contractId: string,
  issueDate: string,
  days: string,
) {
  const draft = await invoices.createDraft(tx, caller, noopAudit, issueDate, {
    partnerId,
    contractId,
    issueDate,
    periodLabel: "2026 April",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
  });
  const id = draft.data?.id as string;
  const line = draft.data?.lines[0];
  await invoices.updateDraft(tx, caller, noopAudit, {
    id,
    lines: [
      {
        description: "Consulting",
        quantity: days,
        unitPrice: "1000.00",
        vatRate: line?.vatRate ?? "0",
        rateSourceId: line?.rateSourceId ?? null,
      },
    ],
  });
  const r = await invoices.issue(
    tx,
    caller,
    realAudit(tx, caller),
    new Date(`${issueDate}T10:00:00Z`),
    { id },
  );
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** Q2 2026 under the CH registration: Vaudoise 10 000 CHF (8.1 %), Berlin GmbH 5 000 CHF (export), a 1 000 credit, CH input VAT. */
async function quarter(): Promise<Fixture> {
  const caller = owner.caller;
  return run(caller, async (tx) => {
    const reg = await settings.createVatRegistration(tx, caller, noopAudit, {
      country: "CH",
      vatNumber: "CHE-123.456.789 TVA",
      rateSchedule: { rates: [8.1, 2.6, 3.8] },
    });
    const regId = reg.data?.id as string;
    const swiss = await client(caller, tx, "Vaudoise Assurances", "VA", "CH", regId);
    const german = await client(caller, tx, "Berlin GmbH", "BG", "DE", regId);
    const swissInv = await issued(
      caller,
      tx,
      swiss.partnerId,
      swiss.contractId,
      "2026-05-10",
      "10",
    );
    const germanInv = await issued(
      caller,
      tx,
      german.partnerId,
      german.contractId,
      "2026-05-11",
      "5",
    );
    expect(swissInv.vatAmount).toBe("810.00");
    expect(germanInv.vatAmount).toBe("0.00");
    expect(swissInv.declarationPeriod).toBe(PERIOD);
    // a 1 000 CHF credit on the Swiss invoice, issued in June
    const cn = await invoices.createCreditNote(tx, caller, noopAudit, "2026-06-01", {
      originalId: swissInv.id,
      lines: [{ lineId: swissInv.lines[0]?.id as string, quantity: "1" }],
    });
    if (cn.error) throw new Error(cn.error.message);
    const creditIssued = await invoices.issue(
      tx,
      caller,
      realAudit(tx, caller),
      new Date("2026-06-01T10:00:00Z"),
      {
        id: cn.data.id,
      },
    );
    if (creditIssued.error) throw new Error(creditIssued.error.message);
    // CH input VAT: the accountant's CHF invoice (97.20) and a hotel receipt (3.80 at 3.8 %)
    await settings.activateBasCategories(tx, caller, noopAudit, ["653"]);
    await settings.updateBasPreference(tx, caller, noopAudit, "653", { shortCode: "Acc" });
    const vendor = await partners.createPartner(tx, caller, noopAudit, {
      name: "Skattepunkten",
      types: ["vendor"],
      defaultCurrency: "CHF",
    });
    const batch = await expenses.createGroup(tx, caller, noopAudit, {
      description: "2026-06",
      kind: "batch",
    });
    const si = await supplierInvoices.createSupplierInvoice(tx, caller, noopAudit, {
      groupId: batch.data?.id as string,
      partnerId: vendor.data?.id as string,
      invoiceNumber: "9160",
      invoiceDate: "2026-06-15",
      amountNet: "1200.00",
      vatAmount: "97.20",
      amountTotal: "1297.20",
      basCode: "653",
      vatRegistrationId: regId,
    });
    if (si.error) throw new Error(si.error.message);
    const hotel = await expenses.createExpense(tx, caller, noopAudit, {
      groupId: batch.data?.id as string,
      date: "2026-05-12",
      description: "Hotel Zürich",
      basCode: "583",
      amount: "103.80",
      currency: "CHF",
      vatAmount: "3.80",
      vatRegistrationId: regId,
      paymentSourceId: owner.sources.privateCh.id,
    });
    if (hotel.error) throw new Error(hotel.error.message);
    return {
      regId,
      swissId: swissInv.id,
      germanId: germanInv.id,
      creditId: cn.data.id,
      chExpenseId: hotel.data.id,
    };
  });
}

const byRef = (lines: { ref: string; amount: string; base?: string }[]) =>
  Object.fromEntries(lines.map((l) => [l.ref, l]));

describe("the return of a quarter", () => {
  it("turnover, the export line, the credit note, the rate row, input VAT, the amount to pay", async () => {
    const f = await quarter();
    const r = await run(owner.caller, (tx) =>
      swissVatReturn(tx, owner.caller, { registrationId: f.regId, period: PERIOD, today: TODAY }),
    );
    expect(r.error).toBeUndefined();
    const ret = r.data;
    if (!ret) throw new Error("no return");
    expect(ret).toMatchObject({
      period: PERIOD,
      from: "2026-04-01",
      to: "2026-06-30",
      vatNumber: "CHE-123.456.789 TVA",
    });
    const refs = byRef(ret.lines);
    expect(refs["200"]?.amount).toBe("15000.00");
    expect(refs["221"]?.amount).toBe("5000.00");
    expect(refs["235"]?.amount).toBe("1000.00");
    expect(refs["289"]?.amount).toBe("6000.00");
    expect(refs["299"]?.amount).toBe("9000.00");
    expect(refs["303"]).toMatchObject({ base: "9000.00", amount: "729.00" });
    expect(refs["379"]?.amount).toBe("9000.00");
    expect(refs["399"]?.amount).toBe("729.00");
    expect(refs["400"]?.amount).toBe("101.00"); // 97.20 + 3.80
    expect(refs["479"]?.amount).toBe("101.00");
    expect(refs["500"]?.amount).toBe("628.00");
    expect(refs["510"]?.amount).toBe("0.00");
    expect(ret.warnings).toEqual([]);
    expect(ret.invoices.map((i) => [i.number, i.type, i.swissClient, i.net, i.vat])).toEqual([
      ["BG26-INV-001", "invoice", false, "5000.00", "0.00"],
      ["VA26-CN-001", "credit_note", true, "1000.00", "81.00"],
      ["VA26-INV-001", "invoice", true, "10000.00", "810.00"],
    ]);
    expect(ret.inputSources.map((s) => [s.kind, s.key, s.vat])).toEqual([
      ["supplier_invoice", "SI213-Acc-01", "97.20"],
      ["expense", "Ex213-Rep-01", "3.80"],
    ]);
    expect(ret.declaration).toBeNull();
  });

  it("a EUR invoice under the CH registration is converted at the ECB rate of its date, with a warning", async () => {
    const f = await quarter();
    await run(owner.caller, async (tx) => {
      const eur = await client(owner.caller, tx, "Paris SAS", "PS", "FR", f.regId, "EUR");
      await issued(owner.caller, tx, eur.partnerId, eur.contractId, "2026-05-12", "2");
    });
    const ret = (
      await run(owner.caller, (tx) =>
        swissVatReturn(tx, owner.caller, { registrationId: f.regId, period: PERIOD, today: TODAY }),
      )
    ).data;
    const refs = byRef(ret?.lines ?? []);
    // 2 000 EUR × 0.93 = 1 860.00 CHF abroad
    expect(refs["221"]?.amount).toBe("6860.00");
    expect(refs["200"]?.amount).toBe("16860.00");
    expect(ret?.warnings.map((w) => w.type)).toEqual(["converted"]);
    expect(ret?.invoices.find((i) => i.currency === "EUR")?.conversion?.rate).toBe("0.930000");
  });

  it("the periods: from the first stored quarter to today's, newest first; the CH registrations", async () => {
    const f = await quarter();
    expect(await run(owner.caller, (tx) => swissVatPeriods(tx, TODAY))).toEqual([
      "CH 2026/Q3",
      "CH 2026/Q2",
    ]);
    expect(await run(owner.caller, (tx) => chRegistrations(tx, owner.caller))).toEqual([
      { id: f.regId, vatNumber: "CHE-123.456.789 TVA" },
    ]);
    // the period of an invoice moved into Q4 shows too (a correction into the future)
    await run(owner.caller, (tx) =>
      invoices.setDeclarationPeriod(tx, owner.caller, noopAudit, {
        id: f.germanId,
        declarationPeriod: "CH 2026/Q4",
      }),
    );
    expect(await run(owner.caller, (tx) => swissVatPeriods(tx, TODAY))).toEqual([
      "CH 2026/Q4",
      "CH 2026/Q3",
      "CH 2026/Q2",
    ]);
    const q2 = (
      await run(owner.caller, (tx) =>
        swissVatReturn(tx, owner.caller, { registrationId: f.regId, period: PERIOD, today: TODAY }),
      )
    ).data;
    expect(byRef(q2?.lines ?? [])["221"]?.amount).toBe("0.00");
  });
});

describe("the declaration record (D23)", () => {
  it("manual refs enter the figures; declare freezes them and every invoice of the quarter derives declared", async () => {
    const f = await quarter();
    const caller = owner.caller;
    const manual = await run(caller, (tx) =>
      saveManual(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
        manual: { "220": "500.00", "405": "10.00" },
      }),
    );
    expect(manual.error).toBeUndefined();
    const live = (
      await run(caller, (tx) =>
        swissVatReturn(tx, caller, { registrationId: f.regId, period: PERIOD, today: TODAY }),
      )
    ).data;
    const refs = byRef(live?.lines ?? []);
    expect(refs["220"]?.amount).toBe("500.00");
    expect(refs["299"]?.amount).toBe("8500.00");
    expect(refs["479"]?.amount).toBe("111.00");
    expect(refs["500"]?.amount).toBe("618.00");
    expect(live?.warnings.map((w) => w.type)).toEqual(["plausibility_mismatch"]);
    expect(await run(caller, (tx) => declaredOn(tx, PERIOD))).toBeNull();

    const declared = await run(caller, (tx) =>
      declare(tx, caller, realAudit(tx, caller), {
        vatRegistrationId: f.regId,
        period: PERIOD,
        declaredAt: "2026-07-20",
        lines: live?.lines ?? [],
      }),
    );
    expect(declared.data).toMatchObject({ declaredAt: "2026-07-20", paidAt: null });
    expect(declared.data?.snapshot?.length).toBe(live?.lines.length);
    expect(await run(caller, (tx) => declaredOn(tx, PERIOD))).toEqual({
      declaredAt: "2026-07-20",
      paidAt: null,
    });

    // frozen: a new invoice in the quarter changes the live figures but not the declared ones
    await run(caller, async (tx) => {
      const again = await saveManual(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
        manual: { "220": "1.00" },
      });
      expect(again.error?.message).toMatch(/frozen/);
      const twice = await declare(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
        declaredAt: "2026-07-21",
        lines: [],
      });
      expect(twice.error?.message).toMatch(/already declared/);
    });
    const after = (
      await run(caller, (tx) =>
        swissVatReturn(tx, caller, { registrationId: f.regId, period: PERIOD, today: TODAY }),
      )
    ).data;
    expect(byRef(after?.lines ?? [])["500"]?.amount).toBe("618.00");
    expect(after?.declaration?.declaredAt).toBe("2026-07-20");
  });

  it("paid with the vat_payment expense; the undo paths; the accountant may not touch any of it", async () => {
    const f = await quarter();
    const caller = owner.caller;
    const live = (
      await run(caller, (tx) =>
        swissVatReturn(tx, caller, { registrationId: f.regId, period: PERIOD, today: TODAY }),
      )
    ).data;
    const payment = await run(caller, async (tx) => {
      const g = await expenses.createGroup(tx, caller, noopAudit, {
        description: "2026-07",
        kind: "batch",
      });
      await settings.activateBasCategories(tx, caller, noopAudit, ["264"]);
      await settings.updateBasPreference(tx, caller, noopAudit, "264", { shortCode: "Vat" });
      const e = await expenses.createExpense(tx, caller, noopAudit, {
        groupId: g.data?.id as string,
        kind: "vat_payment",
        date: "2026-07-25",
        description: "TVA Q2 2026",
        basCode: "264",
        amount: "628.00",
        currency: "CHF",
        paymentSourceId: owner.sources.afChf.id,
      });
      if (e.error) throw new Error(e.error.message);
      return e.data;
    });
    await run(caller, async (tx) => {
      const early = await markPaid(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
        paidAt: "2026-07-25",
      });
      expect(early.error?.message).toMatch(/not declared yet/);
      const d = await declare(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
        declaredAt: "2026-07-20",
        lines: live?.lines ?? [],
      });
      expect(d.error).toBeUndefined();
      const wrong = await markPaid(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
        paidAt: "2026-07-25",
        paymentExpenseId: f.chExpenseId,
      });
      expect(wrong.error?.message).toMatch(/not a VAT payment/);
      const paid = await markPaid(tx, caller, realAudit(tx, caller), {
        vatRegistrationId: f.regId,
        period: PERIOD,
        paidAt: "2026-07-25",
        paymentExpenseId: payment.id,
      });
      expect(paid.data).toMatchObject({ paidAt: "2026-07-25", paymentExpenseId: payment.id });
      expect(await declaredOn(tx, PERIOD)).toEqual({
        declaredAt: "2026-07-20",
        paidAt: "2026-07-25",
      });
      const undoDeclared = await undeclare(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
      });
      expect(undoDeclared.error?.message).toMatch(/undo the payment first/);
      const unpaid = await unmarkPaid(tx, caller, noopAudit, {
        vatRegistrationId: f.regId,
        period: PERIOD,
      });
      expect(unpaid.data?.paidAt).toBeNull();
      const open = await undeclare(tx, caller, realAudit(tx, caller), {
        vatRegistrationId: f.regId,
        period: PERIOD,
      });
      expect(open.data).toMatchObject({ declaredAt: null, snapshot: null });
      expect(await declaredOn(tx, PERIOD)).toBeNull();

      const accountant: CallerIdentity = { ...caller, role: "accountant" };
      for (const r of [
        await saveManual(tx, accountant, noopAudit, {
          vatRegistrationId: f.regId,
          period: PERIOD,
          manual: {},
        }),
        await declare(tx, accountant, noopAudit, {
          vatRegistrationId: f.regId,
          period: PERIOD,
          declaredAt: "2026-07-20",
          lines: [],
        }),
        await markPaid(tx, accountant, noopAudit, {
          vatRegistrationId: f.regId,
          period: PERIOD,
          paidAt: "2026-07-25",
        }),
      ]) {
        expect(r.error?.code).toBe("FORBIDDEN");
      }
      // the accountant reads the return
      const read = await swissVatReturn(tx, accountant, {
        registrationId: f.regId,
        period: PERIOD,
        today: TODAY,
      });
      expect(read.data?.lines.length).toBeGreaterThan(0);
      // an SE registration is refused
      const se = await settings.createVatRegistration(tx, caller, noopAudit, {
        country: "SE",
        vatNumber: "SE556677889001",
      });
      const wrongReg = await saveManual(tx, caller, noopAudit, {
        vatRegistrationId: se.data?.id as string,
        period: PERIOD,
        manual: {},
      });
      expect(wrongReg.error?.message).toMatch(/CH registration/);
    });
  });
});
