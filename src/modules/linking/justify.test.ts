// Justify from the bank row on real rows (specs/justify/spec.md US1, US3, SC-003): one click → one entity, its
// `created_from` and `justifies` links, the row's partner and category by hand; the receipt-lost path; a refused
// step rolls everything back but the document; the no-proof reasons with the rule proposal; RLS.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { createTestClock } from "@/kernel/clock/clock";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import * as banking from "@/modules/banking";
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
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { justifyRow, noProofNeeded } from "./justify";
import { getLinksFor } from "./linking";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;

const storage = {
  ensureContainer: async () => {},
  uploadBlob: async (path: string) => `fs://documents/${path}`,
  downloadBlob: async () => Buffer.from(""),
  deleteBlob: async () => {},
  generateSasUrl: async () => "",
  generateDownloadUrl: async () => "",
} as unknown as StorageService;
const clock = createTestClock(new Date("2026-07-10T10:00:00Z"));

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  for (const date of ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]) {
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 11.6), ($1, 'EUR/CHF', 1)`,
      [date],
    );
  }
  owner = await setupOwner(adminPool, nordeaFormatId);
});

afterAll(async () => {
  await adminPool.end();
});

/** A supplier, a group and the row the proof will justify. */
async function scene(caller: CallerIdentity) {
  return run(caller, async (tx) => {
    await settings.activateBasCategories(tx, caller, noopAudit, ["654"]);
    await settings.updateBasPreference(tx, caller, noopAudit, "654", { shortCode: "IT" });
    const supplier = await partners.createPartner(tx, caller, noopAudit, {
      name: "Skattepunkten Office Services AB",
      shortCode: "SKP",
      types: ["vendor"],
      defaultCurrency: "SEK",
      defaultBasCategoryCode: "654",
    });
    const group = await expenses.createGroup(tx, caller, noopAudit, { description: "July 2026" });
    if (supplier.error || group.error)
      throw new Error(`scene: ${supplier.error?.message ?? group.error?.message}`);
    const [row] = await importRows(tx, caller, owner.accounts.sek, "SEK", [
      { date: "2026-07-08", amount: "-1297.20", name: "SKATTEPUNKTEN OFFICE" },
    ]);
    const doc = await documents.uploadDocument(
      tx,
      caller,
      noopAudit,
      storage,
      clock,
      Buffer.from("%PDF-1.4 skattepunkten"),
      "skattepunkten.pdf",
      "invoice",
    );
    if (doc.error || doc.data.kind !== "stored") throw new Error("upload failed");
    return {
      supplierId: supplier.data?.id as string,
      groupId: group.data?.id as string,
      row: row as string,
      documentId: doc.data.id,
    };
  });
}

describe("justifyRow (US1)", () => {
  it("a supplier invoice from the proof: the entity, created_from, justifies with the full allocation, the row's facts", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const r = await run(caller, (tx) =>
      justifyRow(tx, caller, realAudit(tx, caller), {
        transactionId: s.row,
        documentId: s.documentId,
        kind: "supplier_invoice",
        supplier: {
          groupId: s.groupId,
          partnerId: s.supplierId,
          invoiceNumber: "2026-071",
          invoiceDate: "2026-07-06",
          currency: "SEK",
          amountNet: "1037.76",
          vatAmount: "259.44",
          amountTotal: "1297.20",
          basCode: "654",
        },
      }),
    );
    expect(r.error).toBeUndefined();
    expect(r.data?.entity.type).toBe("supplier_invoice");
    expect(r.data?.row).toEqual({ partnerId: s.supplierId, basCode: "654" });

    await run(caller, async (tx) => {
      const si = await supplierInvoices.getSupplierInvoiceDetail(
        tx,
        caller,
        r.data?.entity.id as string,
        "2026-07-10",
      );
      expect(si.data?.invoice.key).toBe(r.data?.entity.key);
      expect(si.data?.status).toBe("paid");
      const links = await getLinksFor(tx, { type: "bank_transaction", id: s.row });
      expect(links.data?.map((l) => [l.kind, l.allocatedAmount])).toEqual([
        ["justifies", "1297.20"],
      ]);
      const docLinks = await getLinksFor(tx, { type: "document", id: s.documentId });
      expect(docLinks.data?.map((l) => [l.kind, l.from.type])).toEqual([
        ["created_from", "supplier_invoice"],
      ]);
      const facts = (await banking.transactionFacts(tx, [s.row])).get(s.row);
      expect(facts).toMatchObject({
        partnerId: s.supplierId,
        basCode: "654",
        categorisedBy: "manual",
      });
      const state = (await banking.transactionStates(tx, [s.row])).get(s.row);
      expect(state?.state).toBe("linked");
      const doc = await documents.getDocument(tx, s.documentId);
      expect(doc.data?.businessKey).toMatch(new RegExp(`^${r.data?.entity.key}_2026-07-06_`));
    });
  });

  it("an expense from a receipt on the card, paid by the row (D26); the receipt lost → document_missing", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const [cardRow] = await run(caller, (tx) =>
      importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-09", amount: "-523.17", details: "Kortköp 260708 SBB CFF FFS" },
      ]),
    );
    const r = await run(caller, (tx) =>
      justifyRow(tx, caller, noopAudit, {
        transactionId: cardRow as string,
        documentId: s.documentId,
        kind: "expense",
        expense: {
          groupId: s.groupId,
          date: "2026-07-08",
          description: "SBB train",
          basCode: "580",
          amount: "45.00",
          currency: "CHF",
        },
      }),
    );
    expect(r.error).toBeUndefined();
    await run(caller, async (tx) => {
      const e = await expenses.getExpenseDetail(tx, r.data?.entity.id as string);
      // F114: the receipt keeps its own base; the row's SEK sits on the link; the payer is the row's account
      expect(e.data?.expense).toMatchObject({
        amount: "45.00",
        currency: "CHF",
        documentMissing: false,
        paidFromAccountId: owner.accounts.sek,
      });
      expect(e.data?.expense.rateSource).not.toBe("bank");
      expect(e.data).toMatchObject({ status: "paid", allocated: "45.00", allocatedBase: "523.17" });
      const links = await getLinksFor(tx, { type: "bank_transaction", id: cardRow as string });
      expect(
        links.data?.map((l) => [l.kind, l.allocatedAmount, l.currency, l.allocatedBase]),
      ).toEqual([["justifies", "45.00", "CHF", "523.17"]]);
    });

    // the receipt lost: no document, the flag on the entity
    const lost = await run(caller, (tx) =>
      justifyRow(tx, caller, noopAudit, {
        transactionId: s.row,
        kind: "expense",
        expense: {
          groupId: s.groupId,
          date: "2026-07-08",
          description: "Office supplies, receipt lost",
          basCode: "580",
          amount: "1297.20",
          currency: "SEK",
        },
      }),
    );
    expect(lost.error).toBeUndefined();
    await run(caller, async (tx) => {
      const e = await expenses.getExpenseDetail(tx, lost.data?.entity.id as string);
      expect(e.data?.expense.documentMissing).toBe(true);
      // the expense names no merchant: covered, but no partner typed or derived — still to justify (F129, D73)
      expect((await banking.transactionStates(tx, [s.row])).get(s.row)?.state).toBe(
        "linked_no_partner",
      );
    });
  });

  it("a refused step leaves nothing behind: a row already justified, a savings row, an incoming row", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const input = {
      transactionId: s.row,
      documentId: s.documentId,
      kind: "supplier_invoice" as const,
      supplier: {
        groupId: s.groupId,
        partnerId: s.supplierId,
        invoiceNumber: "2026-071",
        invoiceDate: "2026-07-06",
        currency: "SEK" as const,
        amountNet: "1297.20",
        amountTotal: "1297.20",
        basCode: "654",
      },
    };
    expect(
      (await run(caller, (tx) => justifyRow(tx, caller, noopAudit, input))).error,
    ).toBeUndefined();
    // the same row again: refused before any write — the invoice number would be a duplicate too
    const again = await run(caller, (tx) => justifyRow(tx, caller, noopAudit, input));
    expect(again.error?.message).toMatch(/justified already/);
    const [savings, incoming] = await run(caller, async (tx) => [
      ...(await importRows(tx, caller, owner.accounts.sav, "SEK", [
        { date: "2026-07-09", amount: "-10.00", name: "AVGIFT" },
      ])),
      ...(await importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-09", amount: "1000.00", name: "CLIENT" },
      ])),
    ]);
    expect(
      (
        await run(caller, (tx) =>
          justifyRow(tx, caller, noopAudit, { ...input, transactionId: savings as string }),
        )
      ).error?.message,
    ).toMatch(/savings account/);
    expect(
      (
        await run(caller, (tx) =>
          justifyRow(tx, caller, noopAudit, { ...input, transactionId: incoming as string }),
        )
      ).error?.message,
    ).toMatch(/incoming row/);
    await run(caller, async (tx) => {
      expect(
        (
          await supplierInvoices.listSupplierInvoices(
            tx,
            { page: 1, pageSize: 10, sort: [], filters: {} },
            { today: "2026-07-10" },
          )
        ).total,
      ).toBe(1);
    });
  });

  it("F130: the warnings the owner confirmed over go on the justifies link's audit trail; an unknown code is refused", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const base = {
      transactionId: s.row,
      documentId: s.documentId,
      kind: "supplier_invoice" as const,
      supplier: {
        groupId: s.groupId,
        partnerId: s.supplierId,
        invoiceNumber: "2026-071",
        invoiceDate: "2026-07-06",
        currency: "SEK" as const,
        amountNet: "1297.20",
        amountTotal: "1297.20",
        basCode: "654",
      },
    };
    // the boundary: only the seven codes
    const bad = await run(caller, (tx) =>
      justifyRow(tx, caller, noopAudit, {
        ...base,
        confirmedWarnings: ["looks_wrong" as unknown as "date"],
      }),
    );
    expect(bad.error?.code).toBe("VALIDATION_ERROR");

    const r = await run(caller, (tx) =>
      justifyRow(tx, caller, realAudit(tx, caller), {
        ...base,
        confirmedWarnings: ["vendor_counterparty", "date", "vendor_counterparty"],
      }),
    );
    expect(r.error).toBeUndefined();
    const linkId = await run(caller, async (tx) => {
      const links = await getLinksFor(tx, { type: "bank_transaction", id: s.row });
      return links.data?.find((l) => l.kind === "justifies")?.id as string;
    });
    expect(linkId).toBeTruthy();
    const trail = await adminPool.query(
      `SELECT action, new_data FROM audit_logs WHERE entity_type = 'link' AND entity_id = $1 ORDER BY created_at`,
      [linkId],
    );
    expect(trail.rows.map((a) => a.action)).toEqual(["create", "update"]);
    // once each, in the order given — the link's own create row untouched
    expect(trail.rows[1].new_data).toEqual({ confirmedWarnings: ["vendor_counterparty", "date"] });
    expect(trail.rows[0].new_data.kind).toBe("justifies");

    // nothing confirmed: no second row
    const [cardRow] = await run(caller, (tx) =>
      importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-09", amount: "-99.00", details: "Kortköp 260708 KIOSK" },
      ]),
    );
    const plain = await run(caller, (tx) =>
      justifyRow(tx, caller, realAudit(tx, caller), {
        transactionId: cardRow as string,
        kind: "expense",
        confirmedWarnings: [],
        expense: {
          groupId: s.groupId,
          date: "2026-07-08",
          description: "Kiosk",
          basCode: "580",
          amount: "99.00",
          currency: "SEK",
        },
      }),
    );
    expect(plain.error).toBeUndefined();
    const plainLinks = await run(caller, (tx) =>
      getLinksFor(tx, { type: "bank_transaction", id: cardRow as string }),
    );
    const plainTrail = await adminPool.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'link' AND entity_id = $1`,
      [plainLinks.data?.[0]?.id],
    );
    expect(plainTrail.rows.map((a) => a.action)).toEqual(["create"]);
  });

  it("the accountant cannot; another tenant sees nothing", async () => {
    const s = await scene(owner.caller);
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    const r = await run(other, (tx) =>
      justifyRow(tx, other, noopAudit, {
        transactionId: s.row,
        kind: "expense",
        expense: {
          groupId: s.groupId,
          date: "2026-07-08",
          description: "x",
          basCode: "580",
          amount: "1.00",
          currency: "SEK",
        },
      }),
    );
    expect(r.error?.code).toBe("NOT_FOUND");
  });
});

describe("noProofNeeded (US3; F129 US3: a partner, always)", () => {
  it("the reason's account, the flag and the partner, and the rule proposal when no rule hits", async () => {
    const caller = owner.caller;
    const [fee, tax] = await run(caller, (tx) =>
      importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-09", amount: "-40.00", name: "PRISAVGIFT BANK" },
        { date: "2026-07-09", amount: "-12.00", name: "SKATTEVERKET" },
      ]),
    );
    // the first import seeded the four partners (F129 US4): the bank is the fee's partner
    const bank = await run(caller, (tx) => partners.systemPartner(tx, "bank"));
    const skv = await run(caller, (tx) => partners.systemPartner(tx, "tax_agency_se"));
    expect(bank?.name).toBe("Nordea");
    const r = await run(caller, (tx) =>
      noProofNeeded(tx, caller, realAudit(tx, caller), {
        transactionId: fee as string,
        reason: "fee",
        partnerId: bank?.id as string,
      }),
    );
    expect(r.data).toEqual({ basCode: "657", partnerId: bank?.id, proposeRule: true });
    await run(caller, async (tx) => {
      const facts = (await banking.transactionFacts(tx, [fee as string])).get(fee as string);
      expect(facts).toMatchObject({
        noDocumentNeeded: true,
        basCode: "657",
        partnerId: bank?.id,
        categorisedBy: "manual",
      });
      expect(
        (await banking.transactionStates(tx, [fee as string])).get(fee as string),
      ).toMatchObject({
        state: "no_document",
        partnerId: bank?.id,
        partnerFrom: "row",
        partnerName: "Nordea",
      });
    });
    // the reason's account is not in the active set → the owner's own code, or none; the partner is written all the same
    const taxed = await run(caller, (tx) =>
      noProofNeeded(tx, caller, noopAudit, {
        transactionId: tax as string,
        reason: "tax",
        basCode: null,
        partnerId: skv?.id as string,
      }),
    );
    expect(taxed.data).toEqual({ basCode: null, partnerId: skv?.id, proposeRule: true });
    // a counterparty a rule already hits proposes nothing; the learned rule carries the partner (`createRuleFromTransaction`)
    const learned = await run(caller, (tx) =>
      banking.createRuleFromTransaction(tx, caller, noopAudit, {
        transactionId: fee as string,
        noDocumentNeeded: true,
        basCode: "657",
      }),
    );
    expect(learned.data).toMatchObject({ partnerId: bank?.id, noDocumentNeeded: true });
    const again = await run(caller, (tx) =>
      noProofNeeded(tx, caller, noopAudit, {
        transactionId: fee as string,
        reason: "fee",
        partnerId: bank?.id as string,
      }),
    );
    expect(again.data?.proposeRule).toBe(false);
  });

  it("US3-5: without a partner the call is refused and nothing is written — the row stays open", async () => {
    const caller = owner.caller;
    const [fee] = await run(caller, (tx) =>
      importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-09", amount: "-40.00", name: "PRISAVGIFT BANK" },
      ]),
    );
    const r = await run(caller, (tx) =>
      noProofNeeded(tx, caller, noopAudit, {
        transactionId: fee as string,
        reason: "fee",
      } as unknown as Parameters<typeof noProofNeeded>[3]),
    );
    expect(r.error?.code).toBe("VALIDATION_ERROR");
    expect(r.error?.message).toMatch(/A partner is required/);
    await run(caller, async (tx) => {
      const facts = (await banking.transactionFacts(tx, [fee as string])).get(fee as string);
      expect(facts).toMatchObject({
        noDocumentNeeded: false,
        partnerId: null,
        categorisedBy: null,
      });
      expect((await banking.transactionStates(tx, [fee as string])).get(fee as string)?.state).toBe(
        "open",
      );
    });
  });

  it("US3-6: refused on a linked row (the proof exists); a *no proof · no partner* row takes it again", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const bank = await run(caller, (tx) => partners.systemPartner(tx, "bank"));
    const linked = await run(caller, (tx) =>
      justifyRow(tx, caller, noopAudit, {
        transactionId: s.row,
        documentId: s.documentId,
        kind: "supplier_invoice",
        supplier: {
          groupId: s.groupId,
          partnerId: s.supplierId,
          invoiceNumber: "2026-071",
          invoiceDate: "2026-07-06",
          currency: "SEK",
          amountNet: "1037.76",
          vatAmount: "259.44",
          amountTotal: "1297.20",
          basCode: "654",
        },
      }),
    );
    expect(linked.error).toBeUndefined();
    const refused = await run(caller, (tx) =>
      noProofNeeded(tx, caller, noopAudit, {
        transactionId: s.row,
        reason: "other",
        partnerId: bank?.id as string,
      }),
    );
    expect(refused.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(refused.error?.message).toMatch(/linked — remove the link first/);

    // a row flagged by hand without a partner (as the categorise form can): *no proof · no partner* — `n` places it
    const [misc] = await run(caller, (tx) =>
      importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-09", amount: "-99.00", name: "MISC" },
      ]),
    );
    await run(caller, (tx) =>
      banking.categorise(tx, caller, noopAudit, misc as string, { noDocumentNeeded: true }),
    );
    await run(caller, async (tx) => {
      expect(
        (await banking.transactionStates(tx, [misc as string])).get(misc as string)?.state,
      ).toBe("no_document_no_partner");
    });
    const placed = await run(caller, (tx) =>
      noProofNeeded(tx, caller, noopAudit, {
        transactionId: misc as string,
        reason: "other",
        basCode: null,
        partnerId: bank?.id as string,
      }),
    );
    expect(placed.error).toBeUndefined();
    await run(caller, async (tx) => {
      expect(
        (await banking.transactionStates(tx, [misc as string])).get(misc as string)?.state,
      ).toBe("no_document");
    });
  });
});

describe("justifyRow's rule proposal (F129 US6, D74)", () => {
  it("names the key and the proof's partner with the category when no active rule names that partner; null once one does", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const input = (transactionId: string, invoiceNumber: string) => ({
      transactionId,
      kind: "supplier_invoice" as const,
      supplier: {
        groupId: s.groupId,
        partnerId: s.supplierId,
        invoiceNumber,
        invoiceDate: "2026-07-06",
        currency: "SEK" as const,
        amountNet: "1037.76",
        vatAmount: "259.44",
        amountTotal: "1297.20",
        basCode: "654",
      },
    });
    const first = await run(caller, (tx) =>
      justifyRow(tx, caller, noopAudit, { ...input(s.row, "2026-071"), documentId: s.documentId }),
    );
    expect(first.error).toBeUndefined();
    expect(first.data?.proposeRule).toEqual({
      name: "SKATTEPUNKTEN OFFICE",
      matchType: "contains",
      matchField: "counterparty_key",
      matchPattern: "SKATTEPUNKTEN OFFICE",
      partnerId: s.supplierId,
      basCode: "654",
    });
    // accepting it: the rule is created from the draft, applied to the row at once
    const draft = first.data?.proposeRule;
    const rule = await run(caller, (tx) =>
      banking.createRuleFromTransaction(tx, caller, noopAudit, { transactionId: s.row, ...draft }),
    );
    expect(rule.data).toMatchObject({
      ruleSource: "learned",
      partnerId: s.supplierId,
      basCode: "654",
      matchPattern: "SKATTEPUNKTEN OFFICE",
    });
    expect(
      (await run(caller, (tx) => banking.rulesForKey(tx, "SKATTEPUNKTEN OFFICE"))).map(
        (r) => r.partnerId,
      ),
    ).toEqual([s.supplierId]);
    // the next justify of the same key proposes nothing
    const [second] = await run(caller, (tx) =>
      importRows(tx, caller, owner.accounts.sek, "SEK", [
        { date: "2026-07-09", amount: "-1297.20", name: "SKATTEPUNKTEN OFFICE" },
      ]),
    );
    const next = await run(caller, (tx) =>
      justifyRow(tx, caller, noopAudit, input(second as string, "2026-072")),
    );
    expect(next.error).toBeUndefined();
    expect(next.data?.proposeRule).toBeNull();
  });
});
