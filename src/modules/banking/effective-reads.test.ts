// T050 (US4 / FR-006, D58, D82): the one derived partner and category is what every read of a bank row shows — the
// list's column, filter, distinct values and sort (server-side, D20), the panel's read, the states every other
// module reads. A value typed by hand wins, else the proof's, else a rule's; nothing is written by a read. The
// package's bank sheet is `package.test.ts`; the Swiss VAT return reads no bank row (its facts are the entities').
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import type { ListQuery } from "@/kernel/list-query/types";
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
import { categorise, transactionFacts } from "./facts";
import {
  distinctTransactionValues,
  getTransaction,
  listTransactions,
  transactionStates,
} from "./queries";
import { createRule } from "./rules";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  owner = await setupOwner(adminPool, nordeaFormatId);
}, 30_000);
afterAll(async () => {
  await adminPool.end();
});

/**
 * A rule that guesses 6570 · *Old Guess AB* for every *LAGERHUSET* row, then four rows it categorised:
 * `ruleProof` paid a 6540 supplier invoice of *Lagerhuset Kontor AB* (the proof speaks over the guess), `handProof`
 * the same, then the owner typed 6530 · *Hand Pick AB* by hand (his values speak over the proof), `ruleOnly` has no
 * proof (the guess is what it says), `noteProof` is proven and the owner only typed a note (the guess goes, D82).
 */
async function scene(caller: CallerIdentity) {
  return run(caller, async (tx) => {
    await settings.activateBasCategories(tx, caller, noopAudit, ["6530", "6540", "6570"]);
    await settings.updateBasPreference(tx, caller, noopAudit, "6540", { shortCode: "IT" });
    const mk = async (name: string, shortCode: string) => {
      const p = await partners.createPartner(tx, caller, noopAudit, {
        name,
        shortCode,
        types: ["vendor"],
        defaultCurrency: "SEK",
      });
      if (p.error) throw new Error(p.error.message);
      return p.data.id;
    };
    const supplier = await mk("Lagerhuset Kontor AB", "LHK");
    const guess = await mk("Old Guess AB", "OGA");
    const hand = await mk("Hand Pick AB", "HPA");
    const rule = await createRule(tx, caller, noopAudit, {
      name: "Lagerhuset guess",
      matchType: "contains",
      matchPattern: "LAGERHUSET",
      basCode: "6570",
      partnerId: guess,
    });
    if (rule.error) throw new Error(rule.error.message);
    const [ruleProof, handProof, ruleOnly, noteProof] = (await importRows(
      tx,
      caller,
      owner.accounts.sek,
      "SEK",
      [
        { date: "2026-07-08", amount: "-1250.00", name: "LAGERHUSET KONTOR" },
        { date: "2026-07-09", amount: "-500.00", name: "LAGERHUSET KONTOR" },
        { date: "2026-07-10", amount: "-40.00", name: "LAGERHUSET KONTOR" },
        { date: "2026-07-11", amount: "-300.00", name: "LAGERHUSET KONTOR" },
      ],
    )) as [string, string, string, string];
    const group = await expenses.createGroup(tx, caller, noopAudit, { description: "July 2026" });
    if (group.error) throw new Error(group.error.message);
    const pay = async (row: string, n: string, total: string) => {
      const si = await supplierInvoices.createSupplierInvoice(tx, caller, realAudit(tx, caller), {
        groupId: group.data.id,
        partnerId: supplier,
        invoiceNumber: n,
        invoiceDate: "2026-07-01",
        amountNet: total,
        vatAmount: "0.00",
        amountTotal: total,
        basCode: "6540",
      });
      if (si.error) throw new Error(si.error.message);
      const paid = await supplierInvoices.recordPayment(tx, caller, realAudit(tx, caller), {
        invoiceId: si.data.id,
        bankTransactionId: row,
        amount: total,
      });
      if (paid.error) throw new Error(paid.error.message);
    };
    await pay(ruleProof, "LH-1", "1250.00");
    await pay(handProof, "LH-2", "500.00");
    await pay(noteProof, "LH-3", "300.00");
    const typed = await categorise(tx, caller, noopAudit, handProof, {
      basCode: "6530",
      partnerId: hand,
    });
    const noted = await categorise(tx, caller, noopAudit, noteProof, { note: "office chairs" });
    if (typed.error || noted.error) throw new Error("categorise failed");
    return { supplier, guess, hand, ruleProof, handProof, ruleOnly, noteProof };
  });
}

const query = (q: Partial<ListQuery> = {}): ListQuery => ({
  page: 1,
  pageSize: 50,
  sort: [],
  filters: {},
  ...q,
});

describe("T050 — the effective category and partner in every read", () => {
  it("the rows' typed values are left as they were: a read writes nothing", async () => {
    const s = await scene(owner.caller);
    const typed = await run(owner.caller, (tx) =>
      transactionFacts(tx, [s.ruleProof, s.handProof, s.ruleOnly, s.noteProof]),
    );
    expect(typed.get(s.ruleProof)).toMatchObject({
      basCode: "6570",
      partnerId: s.guess,
      categorisedBy: "rule",
    });
    expect(typed.get(s.handProof)).toMatchObject({
      basCode: "6530",
      partnerId: s.hand,
      categorisedBy: "manual",
    });
    expect(typed.get(s.ruleOnly)).toMatchObject({ basCode: "6570", categorisedBy: "rule" });
    // D82: a note typed by hand on a proven row drops the rule's guess — it would have become a hand-typed value
    expect(typed.get(s.noteProof)).toMatchObject({
      basCode: null,
      partnerId: null,
      note: "office chairs",
      categorisedBy: "manual",
    });
  });

  it("the list: the column, the filter, the distinct values and the sort read the effective values", async () => {
    const s = await scene(owner.caller);
    await run(owner.caller, async (tx) => {
      const all = await listTransactions(tx, query());
      const byId = new Map(all.rows.map((r) => [r.id, r]));
      expect(byId.get(s.ruleProof)).toMatchObject({
        basCode: "6540",
        basFrom: "proof",
        partnerId: s.supplier,
        partnerName: "Lagerhuset Kontor AB",
        partnerFrom: "proof",
        state: "linked",
      });
      expect(byId.get(s.handProof)).toMatchObject({
        basCode: "6530",
        basFrom: "row",
        partnerName: "Hand Pick AB",
        partnerFrom: "row",
      });
      expect(byId.get(s.ruleOnly)).toMatchObject({
        basCode: "6570",
        basFrom: "row",
        partnerName: "Old Guess AB",
        state: "open",
      });
      expect(byId.get(s.noteProof)).toMatchObject({ basCode: "6540", partnerFrom: "proof" });

      // the filter: 6540 finds the proven rows whatever the rule guessed; 6570 only the unproven guess
      const proofCode = await listTransactions(
        tx,
        query({ filters: { basCode: { kind: "in", values: ["6540"] } } }),
      );
      expect(proofCode.rows.map((r) => r.id).sort()).toEqual([s.ruleProof, s.noteProof].sort());
      const guessCode = await listTransactions(
        tx,
        query({ filters: { basCode: { kind: "in", values: ["6570"] } } }),
      );
      expect(guessCode.rows.map((r) => r.id)).toEqual([s.ruleOnly]);
      const byPartner = await listTransactions(
        tx,
        query({ filters: { partnerId: { kind: "in", values: [s.guess] } } }),
      );
      expect(byPartner.rows.map((r) => r.id)).toEqual([s.ruleOnly]);
      const byName = await listTransactions(tx, query({ search: "Hand Pick" }));
      expect(byName.rows.map((r) => r.id)).toEqual([s.handProof]);

      // the header filter's checkbox list counts the effective values
      const distinct = await distinctTransactionValues(tx, "basCode", query());
      expect(distinct).toEqual(
        expect.arrayContaining([
          { value: "6530", count: 1 },
          { value: "6540", count: 2 },
          { value: "6570", count: 1 },
        ]),
      );
      expect(distinct).toHaveLength(3);

      // the sort: by the effective code, then the date
      const sorted = await listTransactions(
        tx,
        query({
          sort: [
            { col: "basCode", dir: "asc" },
            { col: "bookingDate", dir: "asc" },
          ],
        }),
      );
      expect(sorted.rows.map((r) => r.id)).toEqual([
        s.handProof,
        s.ruleProof,
        s.noteProof,
        s.ruleOnly,
      ]);
    });
  });

  it("the panel's read and the states other modules read say the same", async () => {
    const s = await scene(owner.caller);
    await run(owner.caller, async (tx) => {
      const proven = await getTransaction(tx, s.ruleProof);
      expect(proven.data?.effective).toMatchObject({
        basCode: "6540",
        basFrom: "proof",
        basLabel: expect.stringMatching(/^6540/),
        partnerName: "Lagerhuset Kontor AB",
        partnerFrom: "proof",
        mixed: false,
      });
      const hand = await getTransaction(tx, s.handProof);
      expect(hand.data?.effective).toMatchObject({
        basCode: "6530",
        basFrom: "row",
        partnerName: "Hand Pick AB",
        partnerFrom: "row",
      });
      const states = await transactionStates(tx, [s.ruleProof, s.handProof, s.ruleOnly]);
      expect(states.get(s.ruleProof)).toMatchObject({ basCode: "6540", partnerId: s.supplier });
      expect(states.get(s.handProof)).toMatchObject({ basCode: "6530", partnerId: s.hand });
      expect(states.get(s.ruleOnly)).toMatchObject({ basCode: "6570", partnerId: s.guess });
    });
  });
});
