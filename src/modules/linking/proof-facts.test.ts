// The facts the reading dialog's checks need from the server (F131, `proofFacts`): the ECB rate of the booking date,
// D53's verdict against the company profile, the rules' partners for the key (D74), the memory, the row a document
// already justifies, the supplier's number taken (D35) — read from real rows; RLS. Invented values (D51).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { createTestClock } from "@/kernel/clock/clock";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  run,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { justifyRow } from "./justify";
import { proofFacts } from "./proof-facts";

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
  await adminPool.query(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ('2026-07-08', 'EUR/SEK', 11.6)`,
  );
  owner = await setupOwner(adminPool, nordeaFormatId);
});

afterAll(async () => {
  await adminPool.end();
});

/** A supplier with a VAT number, a rule naming it for a key, two rows, a document, a paid supplier invoice. */
async function scene(caller: CallerIdentity) {
  return run(caller, async (tx) => {
    await settings.activateBasCategories(tx, caller, noopAudit, ["6540"]);
    await settings.updateBasPreference(tx, caller, noopAudit, "6540", { shortCode: "IT" });
    const supplier = await partners.createPartner(tx, caller, noopAudit, {
      name: "Skattepunkten Office Services AB",
      shortCode: "SKP",
      types: ["vendor"],
      vatNumber: "SE556677889901",
    });
    const other = await partners.createPartner(tx, caller, noopAudit, {
      name: "Northwind Cloud AB",
      shortCode: "NWC",
      types: ["vendor"],
    });
    const group = await expenses.createGroup(tx, caller, noopAudit, { description: "2026-07" });
    if (supplier.error || other.error || group.error) throw new Error("scene");
    const rule = await banking.createRule(tx, caller, noopAudit, {
      name: "MSFT → Northwind",
      matchType: "contains",
      matchPattern: "MSFT",
      partnerId: other.data?.id,
    });
    if (rule.error) throw new Error(`rule: ${rule.error.message}`);
    const [first, second, msft] = await importRows(tx, caller, owner.accounts.sek, "SEK", [
      { date: "2026-07-08", amount: "-1297.20", name: "SKATTEPUNKTEN OFFICE" },
      { date: "2026-07-09", amount: "-1297.20", name: "SKATTEPUNKTEN OFFICE" },
      { date: "2026-07-08", amount: "-141.90", details: "Kortköp 260707 MSFT" },
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
      otherId: other.data?.id as string,
      groupId: group.data?.id as string,
      first: first as string,
      second: second as string,
      msft: msft as string,
      documentId: doc.data.id,
    };
  });
}

describe("proofFacts (F131)", () => {
  it("the rules' partners for the key (D74), the memory after a link, the ECB rate across currencies, D53's verdict", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    // before anything: no memory, no rule for SKATTEPUNKTEN, nothing read about the customer, no rate needed in SEK
    const fresh = await run(caller, (tx) =>
      proofFacts(tx, caller, {
        transactionId: s.first,
        documentId: s.documentId,
        readingCurrency: "SEK",
      }),
    );
    expect(fresh).toMatchObject({
      fxRate: null,
      billedToFits: null,
      rulePartnerIds: [],
      memory: [],
      documentJustifiesOther: null,
      supplierNumberTaken: false,
    });
    expect(fresh?.companyName).not.toBe("");
    // D53: the paper addressed to the company fits
    const fits = await run(caller, (tx) =>
      proofFacts(tx, caller, { transactionId: s.first, customerName: fresh?.companyName }),
    );
    expect(fits?.billedToFits).toBe(true);
    // the MSFT row: the rule names Northwind; the reading in EUR gets the booking date's rate
    const card = await run(caller, (tx) =>
      proofFacts(tx, caller, {
        transactionId: s.msft,
        readingCurrency: "EUR",
        customerName: "Someone Else AB",
      }),
    );
    expect(card).toMatchObject({
      rulePartnerIds: [s.otherId],
      fxRate: "11.6",
      fxRateDate: "2026-07-08",
      billedToFits: false,
    });
    // no currency read: no rate looked up
    const unknown = await run(caller, (tx) => proofFacts(tx, caller, { transactionId: s.msft }));
    expect(unknown?.fxRate).toBeNull();
  });

  it("after the first row is justified: the memory remembers the supplier, the document is a proof already (through the entity it became), the number is taken (D35)", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const r = await run(caller, (tx) =>
      justifyRow(tx, caller, noopAudit, {
        transactionId: s.first,
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
          basCode: "6540",
        },
      }),
    );
    expect(r.error).toBeUndefined();
    const facts = await run(caller, (tx) =>
      proofFacts(tx, caller, {
        transactionId: s.second,
        documentId: s.documentId,
        readingCurrency: "SEK",
        partnerId: s.supplierId,
        invoiceNumber: " 2026-071 ", // the same number, padded — the one normaliser (audit 32)
      }),
    );
    expect(facts?.memory).toEqual([
      { partnerId: s.supplierId, name: "Skattepunkten Office Services AB", count: 1 },
    ]);
    expect(facts?.documentJustifiesOther).toEqual({ rowDate: "2026-07-08" });
    expect(facts?.supplierNumberTaken).toBe(true);
    // the row that holds the document is not "another" row for itself; another partner's number is free
    const own = await run(caller, (tx) =>
      proofFacts(tx, caller, {
        transactionId: s.first,
        documentId: s.documentId,
        partnerId: s.otherId,
        invoiceNumber: "2026-071",
      }),
    );
    expect(own?.documentJustifiesOther).toBeNull();
    expect(own?.supplierNumberTaken).toBe(false);
  });

  it("another tenant's row is not found (RLS)", async () => {
    const s = await scene(owner.caller);
    const other = await setupOwner(adminPool, nordeaFormatId);
    const theirs = await run(other.caller, (tx) =>
      proofFacts(tx, other.caller, { transactionId: s.first }),
    );
    expect(theirs).toBeNull();
  });
});
