// Reconcile on real rows (F139, specs/linking/reconcile.md): an invented March (D51) — a CHF payment of an issued
// invoice (HIGH, the client's partner → Ready), a SEK card row for a EUR receipt (cross-currency, no partner → To
// check, the bank's FX cost), two twin rows with nothing (Who is this?) → the groups, the stage's fields, the FX,
// the twins; acceptMatch writes the link and the confirmed partner and category in one go; Done today, undo.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import { RollbackError } from "@/kernel/errors/app-error";
import * as banking from "@/modules/banking";
import * as contracts from "@/modules/contracts";
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
import { removeLink } from "./linking";
import { acceptMatch, doneToday, reconcileData } from "./reconcile";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
const NOW = new Date("2026-03-20T10:00:00Z");
const TODAY = "2026-03-20";

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  // 1 EUR = 10.75 SEK = 1 CHF, every day of March
  for (let d = 1; d <= 31; d += 1) {
    const date = `2026-03-${String(d).padStart(2, "0")}`;
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
      vatNumber: "CHE-111.111.111 TVA",
      rateSchedule: { rates: [8.1] },
    });
    const partner = await partners.createPartner(tx, caller, noopAudit, {
      name: "Invented Client SA",
      shortCode: "IC",
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

async function receipt(caller: CallerIdentity) {
  return run(caller, async (tx) => {
    const doc = await tx.document.create({
      data: {
        tenantId: caller.tenantId,
        businessKey: "Up26-03-0101",
        fileName: "invented-receipt.pdf",
        blobUrl: "https://blob.test/r",
        mimeType: "application/pdf",
        fileSize: 10,
        prefixType: "expense",
        documentType: "financial",
        status: "extracted",
        ocrData: {
          extractedData: {
            vendorName: "Invented Tools ApS",
            invoiceTotal: 11.2,
            currency: "EUR",
            invoiceDate: "2026-03-11",
            confidence: 0.9,
            modelUsed: "test",
            pageCount: 1,
            processingTimeMs: 1,
          },
        },
        createdBy: caller.userId,
      },
    });
    return doc.id;
  });
}

async function world() {
  const { invoice, partnerId } = await issuedInvoice(owner.caller);
  const documentId = await receipt(owner.caller);
  const [paid] = await run(owner.caller, (tx) =>
    importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
      {
        date: "2026-03-12",
        amount: "25000.00",
        name: "INVENTED CLIENT SA",
        message: invoice.number ?? "",
      },
    ]),
  );
  const [card, twinA, twinB] = await run(owner.caller, (tx) =>
    importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
      { date: "2026-03-12", amount: "-125.00", details: "Kortköp 260311 INVENTED TOOLS APS" },
      { date: "2026-03-16", amount: "-3850.00", name: "SOMEBODY" },
      { date: "2026-03-16", amount: "-3850.00", name: "SOMEBODY" },
    ]),
  );
  return { invoice, partnerId, documentId, paid, card, twinA, twinB } as {
    invoice: typeof invoice;
    partnerId: string;
    documentId: string;
    paid: string;
    card: string;
    twinA: string;
    twinB: string;
  };
}

describe("reconcileData (F139 FR-001)", () => {
  it("March by default: the groups, the stage's fields, the bank's FX cost, the twins", async () => {
    const w = await world();
    const d = await run(owner.caller, (tx) => reconcileData(tx, TODAY, null));
    expect(d.month).toBe("2026-03");
    expect(d.progress.toJustify).toBe(4);
    const by = new Map(d.rows.map((r) => [r.id, r]));
    expect(by.get(w.paid)).toMatchObject({
      group: "ready",
      partner: { state: "sure", value: w.partnerId, from: "candidate" },
      fx: null,
      twins: [],
    });
    const card = by.get(w.card);
    expect(card?.group).toBe("check");
    expect(card?.inbox.top?.candidate).toMatchObject({ type: "document", id: w.documentId });
    expect(card?.partner.state).toBe("ask");
    // 11.20 EUR at 10.75 = 120.40 SEK; the bank took 125.00: 4.60 SEK, 3.8 %
    expect(card?.fx).toMatchObject({
      original: "11.20",
      originalCurrency: "EUR",
      ecbAmount: "120.40",
      charged: "125.00",
      cost: "4.60",
      costPercent: "3.8",
    });
    expect(by.get(w.twinA)).toMatchObject({ group: "who", twins: [w.twinB] });
    expect(by.get(w.twinB)?.twins).toEqual([w.twinA]);
    expect(d.done).toEqual([]);
  });
});

describe("acceptMatch (F139 FR-002)", () => {
  it("the receipt linked, the partner and the category the owner confirmed set, one transaction; Done today; undo", async () => {
    const w = await world();
    const vendor = await run(owner.caller, (tx) =>
      partners.createPartner(tx, owner.caller, noopAudit, {
        name: "Invented Tools ApS",
        types: ["vendor"],
        defaultCurrency: "EUR",
        defaultLanguage: "en",
      }),
    );
    const link = await run(owner.caller, (tx) =>
      acceptMatch(tx, owner.caller, realAudit(tx, owner.caller), {
        bankTransactionId: w.card,
        to: { type: "document", id: w.documentId },
        partnerId: vendor.data?.id,
        basCode: "6540",
      }),
    );
    expect(link.error).toBeUndefined();
    const row = await run(owner.caller, (tx) => banking.getTransaction(tx, w.card));
    expect(row.data?.transaction).toMatchObject({ partnerId: vendor.data?.id, basCode: "6540" });

    const done = await run(owner.caller, (tx) =>
      doneToday(tx, new Date().toISOString().slice(0, 10)),
    );
    expect(done.map((x) => x.linkId)).toContain(link.data?.id);

    await run(owner.caller, (tx) =>
      removeLink(tx, owner.caller, realAudit(tx, owner.caller), link.data?.id as string),
    );
    const after = await run(owner.caller, (tx) => reconcileData(tx, TODAY, "2026-03"));
    expect(after.rows.map((r) => r.id)).toContain(w.card);
  });

  it("a refused category takes the link back with it", async () => {
    const w = await world();
    await expect(
      run(owner.caller, (tx) =>
        acceptMatch(tx, owner.caller, realAudit(tx, owner.caller), {
          bankTransactionId: w.card,
          to: { type: "document", id: w.documentId },
          basCode: "9999",
        }),
      ),
    ).rejects.toBeInstanceOf(RollbackError);
    const d = await run(owner.caller, (tx) => reconcileData(tx, TODAY, "2026-03"));
    expect(d.rows.find((r) => r.id === w.card)?.inbox.top?.candidate.id).toBe(w.documentId);
  });
});
