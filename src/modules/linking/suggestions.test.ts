// Suggestions on real rows (specs/linking/spec.md US1, US2, SC-003 at the service level): an issued CHF
// invoice against imported Nordea rows, both directions; apply with the proposed allocation; the short payment;
// a company-paid expense and a supplier-less document for an outgoing row; bulk apply with its skip reasons.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
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
import { getAllocationStatus, getLinksFor, removeLink } from "./linking";
import {
  applySuggestion,
  bulkApplyHigh,
  searchLinkables,
  suggestionsForEntity,
  suggestionsForTransaction,
} from "./suggestions";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
const NOW = new Date("2026-03-20T10:00:00Z");

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  // 1 CHF = 10.75 SEK around the March invoice
  for (const date of ["2026-03-10", "2026-03-12", "2026-03-13", "2026-03-16", "2026-03-31"]) {
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

/** The Swiss client, its contract and an issued CHF invoice of 25 000.00 dated 2026-03-10. */
async function issuedInvoice(caller: CallerIdentity, opts: { amountDays?: string } = {}) {
  return run(caller, async (tx) => {
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
    const draft = await invoices.createDraft(tx, caller, noopAudit, "2026-03-10", {
      partnerId,
      contractId,
      issueDate: "2026-03-10",
      periodLabel: "2026 February",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });
    const id = draft.data?.id as string;
    const line = draft.data?.lines[0];
    await invoices.updateDraft(tx, caller, noopAudit, {
      id,
      lines: [
        {
          description: "Consulting Services",
          quantity: opts.amountDays ?? "20",
          unitPrice: "1250.00",
          vatRate: "0",
          rateSourceId: line?.rateSourceId ?? null,
        },
      ],
    });
    const issued = await invoices.issue(tx, caller, realAudit(tx, caller), NOW, { id });
    if (issued.error) throw new Error(issued.error.message);
    return { invoice: issued.data, partnerId };
  });
}

describe("US1 — suggestions for a bank row and for an entity", () => {
  it("the client's payment finds its invoice: number, name, exact amount, two days → HIGH; the other way round too", async () => {
    const { invoice } = await issuedInvoice(owner.caller);
    expect(invoice.totalAmount).toBe("25000.00");
    const [paid, other] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        {
          date: "2026-03-12",
          amount: "25000.00",
          name: "VAUDOISE ASSURANCES",
          message: `${invoice.number}`,
        },
        { date: "2026-03-13", amount: "3100.00", name: "SOMEONE ELSE", message: "no ref" },
      ]),
    );

    const forRow = await run(owner.caller, (tx) => suggestionsForTransaction(tx, paid as string));
    expect(forRow.error).toBeUndefined();
    const s = forRow.data?.suggestions ?? [];
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      confidence: "HIGH",
      score: 130,
      reference: true,
      crossCurrency: false,
      allocation: "25000.00",
    });
    expect(s[0]?.reasons).toEqual([
      "Invoice number in message",
      "Client name match",
      "Exact amount match",
      "Within 2 days",
    ]);
    expect(s[0]?.candidate).toMatchObject({
      type: "invoice",
      id: invoice.id,
      amount: "25000.00",
      currency: "CHF",
      amountBase: "268750.00",
      direction: "incoming",
      remaining: "25000.00",
    });

    // the 3 100 row: the invoice is 8× its amount → approximate, no reference → LOW (still listed)
    const forOther = await run(owner.caller, (tx) =>
      suggestionsForTransaction(tx, other as string),
    );
    expect(forOther.data?.suggestions.map((x) => x.confidence)).toEqual(["LOW"]);

    // the invoice's side: the two incoming CHF rows of the window, the right one first
    const forInvoice = await run(owner.caller, (tx) =>
      suggestionsForEntity(tx, { type: "invoice", id: invoice.id }),
    );
    expect(forInvoice.error).toBeUndefined();
    expect(forInvoice.data?.suggestions.map((x) => [x.candidate.id, x.confidence])).toEqual([
      [paid, "HIGH"],
      [other, "LOW"],
    ]);
  });

  it("an SEK row for a CHF invoice is a cross-currency lead with no allocation; it is never applied", async () => {
    const { invoice } = await issuedInvoice(owner.caller);
    const [sekRow] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        {
          date: "2026-03-12",
          amount: "268750.00",
          name: "VAUDOISE ASSURANCES",
          message: "payment",
        },
      ]),
    );
    const r = await run(owner.caller, (tx) => suggestionsForTransaction(tx, sekRow as string));
    const s = r.data?.suggestions[0];
    expect(s).toMatchObject({ crossCurrency: true, allocation: null, reference: true });
    expect(s?.reasons).toContain("Cross-currency match (CHF→SEK at ECB)");
    expect(s?.reasons).toContain("Currency differs but reference matches");
    const apply = await run(owner.caller, (tx) =>
      applySuggestion(tx, owner.caller, realAudit(tx, owner.caller), {
        bankTransactionId: sekRow as string,
        to: { type: "invoice", id: invoice.id },
      }),
    );
    expect(apply.error?.message).toMatch(/paid in its own currency/);
    const bulk = await run(owner.caller, (tx) =>
      bulkApplyHigh(tx, owner.caller, noopAudit, [sekRow as string]),
    );
    expect(bulk.skipped[0]?.reason).toBe("CURRENCY_MISMATCH");
  });

  it("an outgoing row finds the company-paid expense and the receipt document, not the client invoice", async () => {
    await issuedInvoice(owner.caller);
    const { expenseId, documentId } = await run(owner.caller, async (tx) => {
      const group = await expenses.createGroup(tx, owner.caller, noopAudit, {
        description: "Online subscriptions March",
      });
      const e = await expenses.createExpense(tx, owner.caller, noopAudit, {
        groupId: group.data?.id as string,
        date: "2026-03-12",
        description: "OpenAI subscription",
        basCode: "580",
        amount: "132.52",
        currency: "SEK",
        paymentSourceId: owner.sources.afSek.id,
      });
      if (e.error) throw new Error(e.error.message);
      // a reviewed receipt with an OCR total, not yet anything
      const doc = await tx.document.create({
        data: {
          tenantId: owner.caller.tenantId,
          businessKey: "Up26-03-0001",
          fileName: "anthropic-receipt.pdf",
          blobUrl: "https://blob.test/x",
          mimeType: "application/pdf",
          fileSize: 10,
          prefixType: "expense",
          documentType: "financial",
          status: "extracted",
          ocrData: {
            extractedData: {
              vendorName: "Anthropic",
              invoiceTotal: 2312.43,
              currency: "SEK",
              invoiceDate: "2026-03-11",
              confidence: 0.9,
              modelUsed: "test",
              pageCount: 1,
              processingTimeMs: 1,
            },
          },
          createdBy: owner.caller.userId,
        },
      });
      return { expenseId: e.data.id, documentId: doc.id };
    });
    const [openai, anthropic] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-12", amount: "-132.52", details: "Kortköp 260311 OPENAI *CHATGPT SUBS" },
        { date: "2026-03-13", amount: "-2312.43", details: "Kortköp 260312 ANTHROPIC* CLAUDE" },
      ]),
    );
    const a = await run(owner.caller, (tx) => suggestionsForTransaction(tx, openai as string));
    expect(
      a.data?.suggestions.map((x) => [x.candidate.type, x.candidate.id, x.confidence]),
    ).toEqual([
      ["expense", expenseId, "HIGH"],
      ["document", documentId, "LOW"],
    ]);
    const b = await run(owner.caller, (tx) => suggestionsForTransaction(tx, anthropic as string));
    expect(b.data?.suggestions[0]).toMatchObject({
      candidate: { type: "document", id: documentId },
      confidence: "HIGH",
      allocation: "2312.43",
    });
    expect(b.data?.suggestions[0]?.reasons).toContain("Partner name match"); // "Anthropic" is the OCR vendor
    expect(a.data?.suggestions[0]?.reasons).toContain("Description keyword match"); // "OpenAI" ↔ OPENAI
  });
});

describe("US2 — apply, allocate, unlink", () => {
  it("applies with the proposed allocation; the invoice derives paid; unlinking reopens both", async () => {
    const { invoice } = await issuedInvoice(owner.caller);
    const [paid] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-12", amount: "25000.00", name: "VAUDOISE", message: invoice.number ?? "" },
      ]),
    );
    const link = await run(owner.caller, (tx) =>
      applySuggestion(tx, owner.caller, realAudit(tx, owner.caller), {
        bankTransactionId: paid as string,
        to: { type: "invoice", id: invoice.id },
      }),
    );
    expect(link.error).toBeUndefined();
    expect(link.data).toMatchObject({
      kind: "justifies",
      allocatedAmount: "25000.00",
      currency: "CHF",
    });
    const status = await run(owner.caller, (tx) =>
      getAllocationStatus(tx, { type: "invoice", id: invoice.id }),
    );
    expect(status.data).toMatchObject({ allocated: "25000.00", remaining: "0.00" });
    const row = await run(owner.caller, (tx) => suggestionsForTransaction(tx, paid as string));
    expect(row.data?.row.remaining).toBe("0.00");
    expect(row.data?.suggestions).toEqual([]);
    const inv = await run(owner.caller, (tx) => invoices.getInvoice(tx, invoice.id, "2026-03-20"));
    expect(inv.data?.state).toBe("paid");

    await run(owner.caller, async (tx) => {
      const r = await removeLink(
        tx,
        owner.caller,
        realAudit(tx, owner.caller),
        link.data?.id as string,
      );
      expect(r.error).toBeUndefined();
    });
    const again = await run(owner.caller, (tx) =>
      getAllocationStatus(tx, { type: "invoice", id: invoice.id }),
    );
    expect(again.data?.remaining).toBe("25000.00");
  });

  it("a short payment (foreign bank fee) allocates what the row has and the invoice is paid within tolerance", async () => {
    const { invoice } = await issuedInvoice(owner.caller);
    const [paid] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-12", amount: "24980.00", name: "VAUDOISE ASSURANCES" },
      ]),
    );
    const s = await run(owner.caller, (tx) => suggestionsForTransaction(tx, paid as string));
    expect(s.data?.suggestions[0]).toMatchObject({ confidence: "HIGH", allocation: "24980.00" });
    const link = await run(owner.caller, (tx) =>
      applySuggestion(tx, owner.caller, noopAudit, {
        bankTransactionId: paid as string,
        to: { type: "invoice", id: invoice.id },
      }),
    );
    expect(link.data?.allocatedAmount).toBe("24980.00");
    const inv = await run(owner.caller, (tx) => invoices.getInvoice(tx, invoice.id, "2026-03-20"));
    expect(inv.data?.state).toBe("paid");
    expect(inv.data?.remaining).toBe("20.00");
    // the invoice is settled: it is no candidate any more
    const [another] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-16", amount: "20.00", name: "VAUDOISE ASSURANCES" },
      ]),
    );
    const none = await run(owner.caller, (tx) => suggestionsForTransaction(tx, another as string));
    expect(none.data?.suggestions).toEqual([]);
  });

  it("two rows pay one invoice: the second one proposes exactly what is left; over-allocation is refused", async () => {
    const { invoice } = await issuedInvoice(owner.caller);
    const [first, second] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-12", amount: "10000.00", name: "VAUDOISE ASSURANCES", message: "part 1" },
        { date: "2026-03-13", amount: "15000.00", name: "VAUDOISE ASSURANCES", message: "part 2" },
      ]),
    );
    const l1 = await run(owner.caller, (tx) =>
      applySuggestion(tx, owner.caller, noopAudit, {
        bankTransactionId: first as string,
        to: { type: "invoice", id: invoice.id },
      }),
    );
    expect(l1.data?.allocatedAmount).toBe("10000.00");
    const s = await run(owner.caller, (tx) => suggestionsForTransaction(tx, second as string));
    expect(s.data?.suggestions[0]).toMatchObject({ allocation: "15000.00" });
    expect(s.data?.suggestions[0]?.reasons).toContain("Exact amount match"); // 15 000 = what is left
    const over = await run(owner.caller, (tx) =>
      applySuggestion(tx, owner.caller, noopAudit, {
        bankTransactionId: second as string,
        to: { type: "invoice", id: invoice.id },
        allocatedAmount: "15000.01",
      }),
    );
    expect(over.error?.message).toMatch(/exceeds the remaining 15000.00 CHF/);
    const l2 = await run(owner.caller, (tx) =>
      applySuggestion(tx, owner.caller, noopAudit, {
        bankTransactionId: second as string,
        to: { type: "invoice", id: invoice.id },
      }),
    );
    expect(l2.data?.allocatedAmount).toBe("15000.00");
    const links = await run(owner.caller, (tx) =>
      getLinksFor(tx, { type: "invoice", id: invoice.id }),
    );
    expect(links.data).toHaveLength(2);
  });

  it("Link to…: searches every registered type by number, key, name or file name", async () => {
    const { invoice } = await issuedInvoice(owner.caller);
    const hits = await run(owner.caller, (tx) => searchLinkables(tx, "VA26"));
    expect(hits.map((h) => [h.type, h.id])).toContainEqual(["invoice", invoice.id]);
    const byName = await run(owner.caller, (tx) => searchLinkables(tx, "vaudoise", ["invoice"]));
    expect(byName.map((h) => h.id)).toEqual([invoice.id]);
    expect(await run(owner.caller, (tx) => searchLinkables(tx, "x"))).toEqual([]);
  });
});

describe("US3 — bulk apply HIGH with the skip reasons", () => {
  it("applies the clear ones, skips the rest with a reason", async () => {
    const { invoice } = await issuedInvoice(owner.caller);
    const [clear, noCandidate, lowOnly] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        {
          date: "2026-03-12",
          amount: "25000.00",
          name: "VAUDOISE ASSURANCES",
          message: invoice.number ?? "",
        },
        { date: "2026-03-31", amount: "900.00", name: "INTEREST" },
        { date: "2026-03-13", amount: "3100.00", name: "SOMEONE ELSE" },
      ]),
    );
    const r = await run(owner.caller, (tx) =>
      bulkApplyHigh(tx, owner.caller, realAudit(tx, owner.caller), [
        noCandidate as string,
        lowOnly as string,
        clear as string,
        clear as string,
      ]),
    );
    expect(r.applied).toEqual([
      {
        bankTransactionId: clear,
        to: { type: "invoice", id: invoice.id },
        allocatedAmount: "25000.00",
      },
    ]);
    expect(r.skipped.map((s) => [s.bankTransactionId, s.reason])).toEqual([
      [noCandidate, "NO_CANDIDATES"],
      [lowOnly, "LOW_CONFIDENCE"],
      [clear, "ALREADY_LINKED"],
    ]);
    expect(r.failed).toEqual([]);
  });

  it("two HIGH candidates within 10 points are ambiguous", async () => {
    await issuedInvoice(owner.caller);
    // a second identical invoice for the same client (another month) — same name, same amount, same day
    const second = await issuedInvoice(owner.caller).catch(() => null);
    expect(second).toBeNull(); // the client short code is unique — build the twin by hand instead
    const twin = await run(owner.caller, async (tx) => {
      const p = await partners.createPartner(tx, owner.caller, noopAudit, {
        name: "Vaudoise Assurances SA",
        shortCode: "VB",
        types: ["client"],
        defaultCurrency: "CHF",
      });
      const c = await contracts.createContract(tx, owner.caller, noopAudit, {
        partnerId: p.data?.id as string,
        name: "Second",
        startDate: "2026-01-01",
        currency: "CHF",
        paymentTerms: "NET_30",
      });
      await contracts.createContractRate(tx, owner.caller, noopAudit, {
        contractId: c.data?.id as string,
        validFrom: "2026-01-01",
        rate: "1250.00",
      });
      const d = await invoices.createDraft(tx, owner.caller, noopAudit, "2026-03-10", {
        partnerId: p.data?.id as string,
        contractId: c.data?.id as string,
        issueDate: "2026-03-10",
        periodLabel: "2026 February",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
      });
      await invoices.updateDraft(tx, owner.caller, noopAudit, {
        id: d.data?.id as string,
        lines: [
          {
            description: "Consulting",
            quantity: "20",
            unitPrice: "1250.00",
            vatRate: "0",
            rateSourceId: d.data?.lines[0]?.rateSourceId ?? null,
          },
        ],
      });
      const i = await invoices.issue(tx, owner.caller, noopAudit, NOW, {
        id: d.data?.id as string,
      });
      return i.data;
    });
    expect(twin?.number).toBe("VB26-INV-001");
    const [row] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-12", amount: "25000.00", name: "VAUDOISE ASSURANCES SA", message: "" },
      ]),
    );
    const r = await run(owner.caller, (tx) =>
      bulkApplyHigh(tx, owner.caller, noopAudit, [row as string]),
    );
    expect(r.skipped[0]?.reason).toBe("AMBIGUOUS");
    expect(r.skipped[0]?.detail).toMatch(/similar scores/);
  });
});
