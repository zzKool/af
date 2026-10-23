// Invoices service — specs/invoices/spec.md user stories 1, 3, 4, 5 against the real database (RLS on).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as contracts from "@/modules/contracts";
import * as linking from "@/modules/linking";
import { _resetLinkables, type Linkable, registerLinkable } from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { creditedSum } from "./credited";
import * as invoices from "./invoices";
import { invoiceLinkable } from "./linkable";
import * as queries from "./queries";
import { ratePricingFromInvoiceLines, rateUsageFromInvoiceLines } from "./rate-usage";

const noopAudit: AuditLogger = { log: async () => {} };
function realAudit(tx: TransactionClient, caller: CallerIdentity): AuditLogger {
  return { log: async (params) => createAuditEntry(tx, caller, params) };
}

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;

/** A fake bank transaction so links can justify invoices before the banking module exists. */
const fakeTransactions = new Set<string>();
const fakeTransactionLinkable: Linkable = {
  type: "bank_transaction",
  async exists(_tx, id) {
    return fakeTransactions.has(id);
  },
  async summary(_tx, id) {
    return fakeTransactions.has(id)
      ? { type: "bank_transaction", id, label: "tx", amount: null, currency: null }
      : null;
  },
};

const TODAY = "2026-02-10";
const NOW = new Date("2026-02-10T10:00:00Z");

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  mockHeaders = new Headers();
  _resetLinkables();
  registerLinkable(invoiceLinkable);
  registerLinkable(fakeTransactionLinkable);
  fakeTransactions.clear();
  // ECB reference rates around the owner's January invoice: 1 CHF = 11.1 / 0.926 = 11.987041 SEK
  await adminPool.query(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES
       ('2026-01-15', 'EUR/SEK', '11.1000'), ('2026-01-15', 'EUR/CHF', '0.9260'),
       ('2026-01-30', 'EUR/SEK', '11.1000'), ('2026-01-30', 'EUR/CHF', '0.9260'),
       ('2026-02-10', 'EUR/SEK', '11.2000'), ('2026-02-10', 'EUR/CHF', '0.9300')`,
  );
});
afterAll(async () => {
  await adminPool.end();
});

/** The owner's world: Swiss client VA (fr, CHF), CH registration 8.1 %, contract NET_30 with the rate history. */
async function world(caller: CallerIdentity, opts: { shortCode?: string | null } = {}) {
  return withTenantTransaction(prisma, caller.tenantId, async (tx) => {
    const reg = await settings.createVatRegistration(tx, caller, noopAudit, {
      country: "CH",
      vatNumber: "CHE-000.000.000 TVA",
      rateSchedule: { rates: [8.1, 2.6, 3.8] },
    });
    const partner = await partners.createPartner(tx, caller, noopAudit, {
      name: "Client VA SA",
      shortCode: opts.shortCode === undefined ? "VA" : (opts.shortCode ?? ""),
      types: ["client"],
      defaultCurrency: "CHF",
      defaultLanguage: "fr",
      address: { street: "Rue Exemple 10", postalCode: "1000", city: "Lausanne", country: "CH" },
      externalIdentifiers: [{ label: "N° Fournisseur", value: "000000" }],
    });
    const contract = await contracts.createContract(tx, caller, noopAudit, {
      partnerId: partner.data?.id as string,
      name: "BI consulting 2026",
      startDate: "2025-01-01",
      currency: "CHF",
      paymentTerms: "NET_30",
      vatRegistrationId: reg.data?.id,
      externalReferences: [{ label: "Bon de commande", value: "4500000000" }],
    });
    const contractId = contract.data?.id as string;
    await contracts.createContractRate(tx, caller, noopAudit, {
      contractId,
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
      rate: "1000.00",
    });
    await contracts.createContractRate(tx, caller, noopAudit, {
      contractId,
      validFrom: "2026-01-01",
      rate: "1200.00",
    });
    return {
      registrationId: reg.data?.id as string,
      partnerId: partner.data?.id as string,
      contractId,
    };
  });
}

/** The January 2026 invoice draft: 20 days at the 2026 rate. */
async function januaryDraft(caller: CallerIdentity, w: { partnerId: string; contractId: string }) {
  return withTenantTransaction(prisma, caller.tenantId, async (tx) => {
    const draft = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
      partnerId: w.partnerId,
      contractId: w.contractId,
      issueDate: "2026-01-31",
      periodLabel: "2026 January",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    const id = draft.data?.id as string;
    const line = draft.data?.lines[0];
    const updated = await invoices.updateDraft(tx, caller, noopAudit, {
      id,
      lines: [
        {
          description: "Consulting Services",
          quantity: "20",
          unitPrice: line?.unitPrice ?? "1200.00",
          vatRate: line?.vatRate ?? "8.1",
          rateSourceId: line?.rateSourceId ?? null,
        },
      ],
    });
    return updated.data as NonNullable<typeof updated.data>;
  });
}

describe("US1 — draft and issue a monthly invoice", () => {
  it("createDraft fills everything from the contract (scenario 1)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const draft = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.createDraft(tx, caller, realAudit(tx, caller), TODAY, {
        partnerId: w.partnerId,
        contractId: w.contractId,
        issueDate: "2026-01-31",
        periodLabel: "2026 January",
        periodStart: "2026-01-01",
      }),
    );
    expect(draft.error).toBeUndefined();
    const d = draft.data as NonNullable<typeof draft.data>;
    expect(d).toMatchObject({
      type: "invoice",
      status: "draft",
      number: null,
      currency: "CHF",
      language: "fr",
      issueDate: "2026-01-31",
      dueDate: "2026-03-02", // NET_30
      vatRegistrationId: w.registrationId,
      declarationPeriod: null,
      baseCurrency: "SEK",
    });
    expect(d.printedReferences).toEqual([
      { label: "N° Fournisseur", value: "000000" },
      { label: "Bon de commande", value: "4500000000" },
    ]);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({
      unit: "day",
      unitPrice: "1200.00",
      vatRate: "8.1",
      quantity: "1",
    });
    expect(d.lines[0].rateSourceId).toBeTruthy();
    await assertAuditLogged(adminPool, caller.tenantId, "create", "invoice", d.id);
  });

  it("totals of 20 days at 1 200 with 8.1 % (scenario 2); the next number is only a hint", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    expect(d).toMatchObject({
      subtotal: "24000.00",
      vatAmount: "1944.00",
      totalAmount: "25944.00",
      vatByRate: [{ rate: "8.1", base: "24000.00", vat: "1944.00" }],
    });
    const hint = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      queries.nextNumberHint(tx, "invoice", "VA", "2026-01-31"),
    );
    expect(hint).toBe("VA26-INV-001");
  });

  it("issue: number, base amounts at the ECB rate of the issue date, declaration period, snapshot, lock (scenario 3)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    const issued = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.issue(tx, caller, realAudit(tx, caller), NOW, { id: d.id }),
    );
    expect(issued.error).toBeUndefined();
    const inv = issued.data as NonNullable<typeof issued.data>;
    expect(inv).toMatchObject({
      status: "issued",
      number: "VA26-INV-001",
      issuedAt: NOW,
      rateToBase: "11.987041",
      rateSource: "ecb_nearest", // 2026-01-31 is a Saturday → Friday's rate, and it says so
      rateDate: "2026-01-30",
      subtotalBase: "287688.98", // 24 000 × 11.987041
      vatBase: "23302.81",
      totalBase: "310991.79", // = subtotalBase + vatBase, reconciles with the SEK parts
      declarationPeriod: "CH 2026/Q1",
    });
    expect(inv.printedParties?.partner).toMatchObject({ name: "Client VA SA" });
    expect(inv.printedParties?.tenant).toMatchObject({
      vatNumber: "CHE-000.000.000 TVA",
      vatCountry: "CH",
    });

    // a second invoice of the same client-year follows; a quote has its own series
    const d2 = await januaryDraft(caller, w);
    const second = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.issue(tx, caller, noopAudit, NOW, { id: d2.id }),
    );
    expect(second.data?.number).toBe("VA26-INV-002");
    await assertAuditLogged(adminPool, caller.tenantId, "update", "invoice", inv.id);
  });

  it("issued documents are locked — service and database (scenario 4)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.issue(tx, caller, noopAudit, NOW, { id: d.id }),
    );
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      expect(
        (await invoices.updateDraft(tx, caller, noopAudit, { id: d.id, notes: "x" })).error?.code,
      ).toBe("BUSINESS_RULE_VIOLATION");
      expect((await invoices.deleteDraft(tx, caller, noopAudit, d.id)).error?.code).toBe(
        "BUSINESS_RULE_VIOLATION",
      );
      expect(
        (await invoices.issue(tx, caller, noopAudit, NOW, { id: d.id })).error?.message,
      ).toContain("already issued");
    });
    // straight SQL, bypassing the service
    await expect(
      adminPool.query("UPDATE invoices SET total_amount = 1 WHERE id = $1", [d.id]),
    ).rejects.toThrow(/invoice_locked/);
    await expect(
      adminPool.query("UPDATE invoices SET status = 'draft' WHERE id = $1", [d.id]),
    ).rejects.toThrow(/invoice_locked/);
    await expect(adminPool.query("DELETE FROM invoices WHERE id = $1", [d.id])).rejects.toThrow(
      /invoice_locked/,
    );
    await expect(
      adminPool.query("UPDATE invoice_lines SET quantity = 1 WHERE invoice_id = $1", [d.id]),
    ).rejects.toThrow(/invoice_locked/);
    await expect(
      adminPool.query(
        `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, description, quantity, unit_price, net_amount, vat_rate, vat_amount, updated_at)
         VALUES ($1, $2, 9, 'x', 1, 1, 1, 0, 0, NOW())`,
        [caller.tenantId, d.id],
      ),
    ).rejects.toThrow(/invoice_locked/);
    // the hand-set facts still move
    const sent = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.markSent(tx, caller, noopAudit, NOW, d.id),
    );
    expect(sent.data?.status).toBe("sent");
    expect(sent.data?.sentAt).toEqual(NOW);
    const moved = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.setDeclarationPeriod(tx, caller, noopAudit, {
        id: d.id,
        declarationPeriod: "CH 2026/Q2",
      }),
    );
    expect(moved.data?.declarationPeriod).toBe("CH 2026/Q2");
  });

  it("issue refusals: no lines, no short code, no exchange rate, due before issue (scenarios 6–7)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller, { shortCode: null });
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const empty = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        partnerId: w.partnerId,
        lines: [],
      });
      expect(empty.data?.lines).toEqual([]);
      expect(empty.data?.currency).toBe("CHF"); // partner default, no contract
      expect(empty.data?.dueDate).toBe(contractsAddDays(TODAY, 30));
      expect(
        (await invoices.issue(tx, caller, noopAudit, NOW, { id: empty.data?.id as string })).error
          ?.message,
      ).toMatch(/At least one line/);

      const d = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        partnerId: w.partnerId,
        contractId: w.contractId,
      });
      const noCode = await invoices.issue(tx, caller, noopAudit, NOW, { id: d.data?.id as string });
      expect(noCode.error?.message).toContain("short code");

      expect(
        (
          await invoices.updateDraft(tx, caller, noopAudit, {
            id: d.data?.id as string,
            dueDate: "2026-01-01",
          })
        ).error?.code,
      ).toBe("VALIDATION_ERROR");
      expect(
        (
          await invoices.updateDraft(tx, caller, noopAudit, {
            id: d.data?.id as string,
            lines: [{ description: "", quantity: "1", unitPrice: "1", vatRate: "0" }],
          })
        ).error?.code,
      ).toBe("VALIDATION_ERROR");
      expect(
        (
          await invoices.updateDraft(tx, caller, noopAudit, {
            id: d.data?.id as string,
            lines: [{ description: "x", quantity: "-1", unitPrice: "1", vatRate: "0" }],
          })
        ).error?.code,
      ).toBe("VALIDATION_ERROR");
    });

    // a USD invoice with no ECB rate for USD → refused, never a silent null base
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      await partners.updatePartner(tx, caller, noopAudit, w.partnerId, { shortCode: "VA" });
      const usd = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        partnerId: w.partnerId,
        currency: "USD",
        lines: [{ description: "x", quantity: "1", unitPrice: "100", vatRate: "0" }],
      });
      const r = await invoices.issue(tx, caller, noopAudit, NOW, { id: usd.data?.id as string });
      expect(r.error?.message).toMatch(/No exchange rate USD\/SEK/);
      // SEK: rate 1, same_currency
      const sek = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        partnerId: w.partnerId,
        currency: "SEK",
        lines: [{ description: "x", quantity: "1", unitPrice: "100", vatRate: "25" }],
      });
      const ok = await invoices.issue(tx, caller, noopAudit, NOW, { id: sek.data?.id as string });
      expect(ok.data).toMatchObject({
        rateToBase: "1",
        rateSource: "same_currency",
        totalBase: "125.00",
      });
      expect(ok.data?.declarationPeriod).toBeNull(); // no CH registration on this one
    });
  });

  it("15 concurrent issues get 15 consecutive numbers; a rolled-back issue hands its number back", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const drafts = await Promise.all(Array.from({ length: 15 }, () => januaryDraft(caller, w)));
    const results = await Promise.all(
      drafts.map((d) =>
        withTenantTransaction(prisma, caller.tenantId, (tx) =>
          invoices.issue(tx, caller, noopAudit, NOW, { id: d.id }),
        ),
      ),
    );
    const numbers = results.map((r) => r.data?.number).sort();
    expect(numbers).toEqual(
      Array.from({ length: 15 }, (_, i) => `VA26-INV-${String(i + 1).padStart(3, "0")}`),
    );

    const d16 = await januaryDraft(caller, w);
    await expect(
      withTenantTransaction(prisma, caller.tenantId, async (tx) => {
        const r = await invoices.issue(tx, caller, noopAudit, NOW, { id: d16.id });
        expect(r.data?.number).toBe("VA26-INV-016");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const again = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.issue(tx, caller, noopAudit, NOW, { id: d16.id }),
    );
    expect(again.data?.number).toBe("VA26-INV-016");
  });
});

describe("F57 — base figures with a header discount", () => {
  it("10 % header discount: subtotalBase is the discounted net converted, subtotalBase + vatBase = totalBase", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    const issued = await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const disc = await invoices.updateDraft(tx, caller, noopAudit, {
        id: d.id,
        discountPercent: "10",
      });
      expect(disc.data).toMatchObject({
        subtotal: "24000.00",
        discountAmount: "2400.00",
        vatAmount: "1749.60",
        totalAmount: "23349.60",
      });
      return invoices.issue(tx, caller, noopAudit, NOW, { id: d.id });
    });
    expect(issued.error).toBeUndefined();
    expect(issued.data).toMatchObject({
      rateToBase: "11.987041",
      subtotalBase: "258920.09", // 21 600 × 11.987041 — no longer 24 000 × rate
      vatBase: "20972.53",
      totalBase: "279892.62",
    });
  });
});

describe("US3 — credit notes", () => {
  it("full credit note: VA26-CN-001 with the original's totals; the original reads credited (scenario 1)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.issue(tx, caller, noopAudit, NOW, { id: d.id }),
    );
    const cn = await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const draft = await invoices.createCreditNote(tx, caller, noopAudit, TODAY, {
        originalId: d.id,
      });
      expect(draft.data).toMatchObject({
        type: "credit_note",
        status: "draft",
        relatedInvoiceId: d.id,
        totalAmount: "25944.00",
        internalNote: "Credit note for VA26-INV-001",
      });
      expect(draft.data?.lines[0].description).toBe("Credit: Consulting Services");
      // before it is issued the original is untouched
      expect((await queries.getInvoice(tx, d.id, TODAY)).data?.state).toBe("issued");
      return invoices.issue(tx, caller, noopAudit, NOW, { id: draft.data?.id as string });
    });
    expect(cn.data).toMatchObject({ number: "VA26-CN-001", declarationPeriod: "CH 2026/Q1" });
    const original = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      queries.getInvoice(tx, d.id, TODAY),
    );
    expect(original.data).toMatchObject({
      state: "credited",
      credited: "25944.00",
      remaining: "0.00",
    });
  });

  it("Σ credited never exceeds the original; partial by quantity; drafts cannot be credited (scenarios 2–3)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      expect(
        (await invoices.createCreditNote(tx, caller, noopAudit, TODAY, { originalId: d.id })).error
          ?.message,
      ).toMatch(/issued/);
      await invoices.issue(tx, caller, noopAudit, NOW, { id: d.id });
      const lineId = (await queries.getInvoice(tx, d.id, TODAY)).data?.lines[0].id as string;

      const partial = await invoices.createCreditNote(tx, caller, noopAudit, TODAY, {
        originalId: d.id,
        lines: [{ lineId, quantity: "5" }],
      });
      expect(partial.data?.totalAmount).toBe("6486.00"); // 5 × 1 200 × 1.081
      await invoices.issue(tx, caller, noopAudit, NOW, { id: partial.data?.id as string });
      expect((await queries.getInvoice(tx, d.id, TODAY)).data).toMatchObject({
        state: "issued",
        credited: "6486.00",
        remaining: "19458.00",
      });
      // F57: a year on, the original is overdue on what is left; the credit note (due = issue) is
      // neither overdue nor open — it is never a receivable
      const later = "2027-02-10";
      expect((await queries.getInvoice(tx, d.id, later)).data).toMatchObject({
        state: "overdue",
        remaining: "19458.00",
      });
      expect((await queries.getInvoice(tx, partial.data?.id as string, later)).data).toMatchObject({
        type: "credit_note",
        state: "issued",
        remaining: "0.00",
      });

      expect(
        (
          await invoices.createCreditNote(tx, caller, noopAudit, TODAY, {
            originalId: d.id,
            lines: [{ lineId, quantity: "21" }],
          })
        ).error?.code,
      ).toBe("VALIDATION_ERROR");
      const tooMuch = await invoices.createCreditNote(tx, caller, noopAudit, TODAY, {
        originalId: d.id,
      });
      const refused = await invoices.issue(tx, caller, noopAudit, NOW, {
        id: tooMuch.data?.id as string,
      });
      expect(refused.error?.message).toMatch(/exceed the original/);
    });
  });
});

describe("US4 — quotes", () => {
  it("quote: valid until +30, VA26-QUO-001, no declaration period; accept; convert; converted state (scenarios 1–3)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const q = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        type: "quote",
        partnerId: w.partnerId,
        contractId: w.contractId,
        issueDate: "2026-01-15",
        lines: [
          { description: "BI project", quantity: "10", unitPrice: "1200.00", vatRate: "8.1" },
        ],
      });
      expect(q.data?.dueDate).toBe("2026-02-14");
      const issued = await invoices.issue(tx, caller, noopAudit, NOW, { id: q.data?.id as string });
      expect(issued.data).toMatchObject({ number: "VA26-QUO-001", declarationPeriod: null });
      const id = issued.data?.id as string;

      expect((await queries.getInvoice(tx, id, "2026-03-01")).data?.state).toBe("expired");
      const accepted = await invoices.decideQuote(tx, caller, noopAudit, NOW, id, "accepted");
      expect(accepted.data?.status).toBe("accepted");
      expect((await queries.getInvoice(tx, id, "2026-03-01")).data?.state).toBe("accepted");

      const converted = await invoices.convertQuote(tx, caller, noopAudit, TODAY, id);
      expect(converted.data).toMatchObject({
        type: "invoice",
        status: "draft",
        relatedInvoiceId: id,
        issueDate: TODAY,
        dueDate: "2026-03-12",
        totalAmount: "12972.00",
      });
      expect(
        (await invoices.convertQuote(tx, caller, noopAudit, TODAY, id)).error?.message,
      ).toMatch(/already converted/);
      expect((await queries.getInvoice(tx, id, TODAY)).data?.state).toBe("accepted"); // draft invoice → not yet
      await invoices.issue(tx, caller, noopAudit, NOW, { id: converted.data?.id as string });
      expect((await queries.getInvoice(tx, id, TODAY)).data).toMatchObject({
        state: "converted",
        convertedTo: "VA26-INV-001",
      });
      // money never settles a quote; the related list shows the invoice
      const related = await queries.relatedDocuments(tx, id);
      expect(related.map((r) => r.number)).toEqual(["VA26-INV-001"]);
    });
  });

  it("decline, and copy-to-draft of anything", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const q = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        type: "quote",
        partnerId: w.partnerId,
        lines: [{ description: "x", quantity: "1", unitPrice: "10", vatRate: "0" }],
      });
      const id = q.data?.id as string;
      expect(
        (await invoices.decideQuote(tx, caller, noopAudit, NOW, id, "declined")).error?.message,
      ).toMatch(/draft/);
      await invoices.issue(tx, caller, noopAudit, NOW, { id });
      expect(
        (await invoices.decideQuote(tx, caller, noopAudit, NOW, id, "declined")).data?.status,
      ).toBe("declined");
      expect(
        (await invoices.convertQuote(tx, caller, noopAudit, TODAY, id)).error?.message,
      ).toMatch(/declined/);
      const copy = await invoices.copyToDraft(tx, caller, noopAudit, TODAY, id);
      expect(copy.data).toMatchObject({
        type: "quote",
        status: "draft",
        relatedInvoiceId: null,
        number: null,
      });
    });
  });
});

describe("lane 5 — the module's exports (lessons audit 27, contracts T024)", () => {
  it("creditedSum: Σ issued credit notes per original, drafts left out", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    const other = await januaryDraft(caller, w);
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      await invoices.issue(tx, caller, noopAudit, NOW, { id: d.id });
      await invoices.issue(tx, caller, noopAudit, NOW, { id: other.id });
      const lineId = (await queries.getInvoice(tx, d.id, TODAY)).data?.lines[0].id as string;
      const credit = (quantity: string) =>
        invoices.createCreditNote(tx, caller, noopAudit, TODAY, {
          originalId: d.id,
          lines: [{ lineId, quantity }],
        });
      const five = await credit("5");
      await invoices.issue(tx, caller, noopAudit, NOW, { id: five.data?.id as string });
      const two = await credit("2");
      await invoices.issue(tx, caller, noopAudit, NOW, { id: two.data?.id as string });
      await credit("1"); // a draft: not a credit yet
      const sums = await creditedSum(tx, [d.id, other.id]);
      expect(sums.get(d.id)).toBe("9080.40"); // (5 + 2) × 1 200 × 1.081
      expect(sums.has(other.id)).toBe(false);
      expect((await creditedSum(tx, [])).size).toBe(0);
    });
  });

  it("ratePricingFromInvoiceLines: lines priced on a rate and the last day priced", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const jan = await januaryDraft(caller, w);
    const rateId = jan.lines[0].rateSourceId as string;
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      expect(await ratePricingFromInvoiceLines(tx, rateId)).toEqual({
        lines: 1,
        lastPeriodStart: "2026-01-01", // no line period → the document's period start
      });
      // a March draft priced on the same rate, its line carrying its own period
      const march = await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        partnerId: w.partnerId,
        contractId: w.contractId,
        issueDate: "2026-03-31",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      });
      expect(march.data?.lines[0]).toMatchObject({
        rateSourceId: rateId,
        periodStart: "2026-03-01",
      });
      // no period at all → the issue date
      await invoices.createDraft(tx, caller, noopAudit, TODAY, {
        partnerId: w.partnerId,
        contractId: w.contractId,
        issueDate: "2026-02-15",
      });
      expect(await ratePricingFromInvoiceLines(tx, rateId)).toEqual({
        lines: 3,
        lastPeriodStart: "2026-03-01",
      });
      expect(await rateUsageFromInvoiceLines(tx, rateId)).toBe(3);
      expect(await ratePricingFromInvoiceLines(tx, crypto.randomUUID())).toEqual({
        lines: 0,
        lastPeriodStart: null,
      });
    });
  });
});

describe("US5 — derived states and the list", () => {
  async function pay(caller: CallerIdentity, invoiceId: string, amount: string) {
    const txId = crypto.randomUUID();
    fakeTransactions.add(txId);
    return withTenantTransaction(prisma, caller.tenantId, (tx) =>
      linking.createLink(tx, caller, noopAudit, {
        from: { type: "bank_transaction", id: txId },
        to: { type: "invoice", id: invoiceId },
        kind: "justifies",
        allocatedAmount: amount,
      }),
    );
  }

  it("paid / partially paid / tolerance / overdue from links and dates (scenarios 1–2)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const d = await januaryDraft(caller, w);
    await withTenantTransaction(prisma, caller.tenantId, (tx) =>
      invoices.issue(tx, caller, noopAudit, NOW, { id: d.id }),
    );
    const state = (today: string) =>
      withTenantTransaction(prisma, caller.tenantId, (tx) =>
        queries.getInvoice(tx, d.id, today),
      ).then((r) => [r.data?.state, r.data?.remaining]);
    expect(await state("2026-02-10")).toEqual(["issued", "25944.00"]);
    expect(await state("2026-03-10")).toEqual(["overdue", "25944.00"]);

    expect((await pay(caller, d.id, "20000.00")).error).toBeUndefined();
    expect(await state("2026-03-10")).toEqual(["partially_paid", "5944.00"]);
    expect((await pay(caller, d.id, "5934.00")).error).toBeUndefined(); // 10 CHF bank fee short
    expect(await state("2026-03-10")).toEqual(["paid", "10.00"]);
    // the linking module never over-allocates
    expect((await pay(caller, d.id, "100.00")).error?.code).toBe("BUSINESS_RULE_VIOLATION");
    // a draft is not linkable
    const draft = await januaryDraft(caller, w);
    expect((await pay(caller, draft.id, "1.00")).error?.code).toBe("NOT_FOUND");
  });

  it("list: derived columns filter, sort and search; distinct states; date hierarchy; sums (scenario 3)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const w = await world(caller);
    const a = await januaryDraft(caller, w);
    const b = await januaryDraft(caller, w);
    await januaryDraft(caller, w); // stays a draft
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      await invoices.issue(tx, caller, noopAudit, NOW, { id: a.id });
      await invoices.issue(tx, caller, noopAudit, NOW, { id: b.id });
      await invoices.markSent(tx, caller, noopAudit, NOW, b.id);
    });
    await pay(caller, a.id, "25944.00");
    const q = { page: 1, pageSize: 25, sort: [], filters: {} };

    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const all = await queries.listInvoices(tx, q, "2026-02-10");
      expect(all.total).toBe(3);
      expect(all.rows.map((r) => r.state).sort()).toEqual(["draft", "paid", "sent"]);
      expect(all.rows[0].partnerName).toBe("Client VA SA");
      expect(all.sums?.totalAmount).toBe("77832.00");
      expect(all.sums?.remaining).toBe("25944.00");

      const paid = await queries.listInvoices(
        tx,
        { ...q, filters: { state: { kind: "in", values: ["paid"] } } },
        "2026-02-10",
      );
      expect(paid.rows.map((r) => r.number)).toEqual(["VA26-INV-001"]);

      const byNumber = await queries.listInvoices(
        tx,
        { ...q, sort: [{ col: "number", dir: "asc" }] },
        "2026-02-10",
      );
      expect(byNumber.rows.map((r) => r.number)).toEqual(["VA26-INV-001", "VA26-INV-002", null]); // blanks last

      const search = await queries.listInvoices(tx, { ...q, search: "client va" }, "2026-02-10");
      expect(search.total).toBe(3);
      const search2 = await queries.listInvoices(
        tx,
        { ...q, search: "VA26-INV-002" },
        "2026-02-10",
      );
      expect(search2.rows.map((r) => r.number)).toEqual(["VA26-INV-002"]);

      const states = await queries.distinctInvoiceValues(tx, "state", q, "2026-02-10");
      expect(states.map((s) => s.value).sort()).toEqual(["draft", "paid", "sent"]);
      const periods = await queries.distinctInvoiceValues(tx, "declarationPeriod", q, "2026-02-10");
      expect(periods).toEqual([
        { value: "CH 2026/Q1", count: 2 },
        { value: null, count: 1 },
      ]);
      const q1 = await queries.listInvoices(
        tx,
        { ...q, filters: { declarationPeriod: { kind: "in", values: ["CH 2026/Q1"] } } },
        "2026-02-10",
      );
      expect(q1.total).toBe(2);
      const dates = await queries.invoiceDateHierarchy(tx, "issueDate", q, "2026-02-10");
      expect(dates.years[0]).toMatchObject({ year: 2026 });
      const remaining = await queries.listInvoices(
        tx,
        { ...q, filters: { remaining: { kind: "range", min: "1" } } },
        "2026-02-10",
      );
      expect(remaining.rows.map((r) => r.number)).toEqual(["VA26-INV-002"]);
    });
  });

  it("RLS: another tenant sees nothing", async () => {
    const a = (await createAuthenticatedContext(auth, "owner")).callerIdentity;
    const b = (await createAuthenticatedContext(auth, "owner")).callerIdentity;
    const w = await world(a);
    const d = await januaryDraft(a, w);
    await withTenantTransaction(prisma, b.tenantId, async (tx) => {
      expect((await queries.getInvoice(tx, d.id, TODAY)).error?.code).toBe("NOT_FOUND");
      expect(
        (await queries.listInvoices(tx, { page: 1, pageSize: 25, sort: [], filters: {} }, TODAY))
          .total,
      ).toBe(0);
      expect((await invoices.issue(tx, b, noopAudit, NOW, { id: d.id })).error?.code).toBe(
        "NOT_FOUND",
      );
    });
  });
});

function contractsAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
