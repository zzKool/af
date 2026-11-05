// Banking's reads against the real database (RLS on): the side panel's History (F71) from the audit trail, and the
// read API other modules call instead of reading `bank_transactions` themselves (lessons audit 23).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestDocument,
} from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import * as expenses from "@/modules/expenses";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { createBankAccount } from "./bank-accounts";
import { categorise, transactionFacts } from "./facts";
import { transactionHistory } from "./history";
import { importCsv } from "./import";
import {
  bookingDates,
  distinctTransactionValues,
  firstBookingDate,
  getTransaction,
  listTransactions,
  outgoingMainRows,
  transactionStates,
} from "./queries";
import { acceptTransfer } from "./transfer-pairs";

const FIXTURES = join(__dirname, "..", "..", "..", "specs", "banking", "fixtures");

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const storage: StorageService = {
  ensureContainer: vi.fn(async () => {}),
  uploadBlob: vi.fn(async (path: string) => `https://blob.test/documents/${path}`),
  downloadBlob: vi.fn(),
  deleteBlob: vi.fn(),
  generateSasUrl: vi.fn(),
  generateDownloadUrl: vi.fn(async () => "https://blob.test/download"),
} as unknown as StorageService;

/** the real trail: History reads what the services write */
const auditFor = (tx: TransactionClient, caller: CallerIdentity): AuditLogger => ({
  log: async (params) => createAuditEntry(tx, caller, params),
});

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  mockHeaders = new Headers();
  await adminPool.query(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES
       ('2026-07-08', 'EUR/SEK', '11.1000'), ('2026-07-08', 'EUR/CHF', '0.9328')`,
  );
});
afterAll(async () => {
  await adminPool.end();
});

const run = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

async function setup(caller: CallerIdentity) {
  return run(caller, async (tx) => {
    const make = (alias: string, number: string, currency: "SEK" | "CHF", savings = false) =>
      createBankAccount(tx, caller, auditFor(tx, caller), {
        accountAlias: alias,
        accountNumber: number,
        currency,
        bankFormatId: nordeaFormatId,
        ...(savings ? { role: "savings" as const } : {}),
      });
    const sek = await make("Plusgirokonto SEK", "123 45 67-8", "SEK");
    const chf = await make("Plusgirokonto CHF", "123 45 67-8", "CHF");
    const sav = await make("Sparkonto", "1234 56 78901", "SEK", true);
    return {
      sek: sek.data?.id as string,
      chf: chf.data?.id as string,
      sav: sav.data?.id as string,
    };
  });
}

async function importFile(caller: CallerIdentity, bankAccountId: string, name: string) {
  const r = await run(caller, (tx) =>
    importCsv(tx, caller, auditFor(tx, caller), storage, {
      bankAccountId,
      fileName: name,
      bytes: readFileSync(join(FIXTURES, name)),
    }),
  );
  expect(r.error).toBeUndefined();
}

/** the CHANGE CHFSEK pair of 2026-07-08, imported (not yet accepted) */
async function pair(caller: CallerIdentity) {
  const ids = await setup(caller);
  await importFile(caller, ids.chf, "nordea-transfer-pair-chf.csv");
  await importFile(caller, ids.sek, "nordea-transfer-pair-sek.csv");
  const [chfTx, sekTx] = await run(caller, (tx) =>
    Promise.all([
      tx.bankTransaction.findFirstOrThrow({ where: { currency: "CHF" } }),
      tx.bankTransaction.findFirstOrThrow({ where: { currency: "SEK" } }),
    ]),
  );
  return { ...ids, chfTx: chfTx.id, sekTx: sekTx.id };
}

describe("F71 — a bank row's History", () => {
  it("import, categorise, mark no document, accept the transfer: newest first, nothing stored", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { chfTx, sekTx } = await pair(caller);

    const fresh = await run(caller, (tx) => transactionHistory(tx, chfTx));
    expect(fresh.data?.map((e) => e.kind)).toEqual(["imported"]);

    await run(caller, async (tx) => {
      const entry = (await transactionFacts(tx, [chfTx])).get(chfTx);
      expect(entry).toBeDefined();
      const audit = auditFor(tx, caller);
      const id = entry?.id as string;
      expect(
        (await categorise(tx, caller, audit, id, { basCode: "657", partnerId: null })).error,
      ).toBeUndefined();
      expect(
        (
          await categorise(tx, caller, audit, id, {
            basCode: "657",
            partnerId: null,
            noDocumentNeeded: true,
          })
        ).error,
      ).toBeUndefined();
    });
    await run(caller, async (tx) => {
      const r = await acceptTransfer(tx, caller, auditFor(tx, caller), {
        fromId: chfTx,
        toId: sekTx,
      });
      expect(r.error).toBeUndefined();
    });

    const after = await run(caller, (tx) => transactionHistory(tx, chfTx));
    expect(after.data?.map((e) => e.kind)).toEqual([
      "linked",
      "no_document",
      "categorised",
      "imported",
    ]);
    expect(after.data?.[0]).toMatchObject({
      linkKind: "transfer",
      otherType: "bank_transaction",
    });
    expect(after.data?.[2]).toMatchObject({ basCode: "657", by: "manual", source: "web" });
    // the other leg sees the same link from its side
    const other = await run(caller, (tx) => transactionHistory(tx, sekTx));
    expect(other.data?.map((e) => e.kind)).toEqual(["linked", "imported"]);
  });

  it("another tenant's row is not found (RLS)", async () => {
    const { callerIdentity: owner } = await createAuthenticatedContext(auth, "owner");
    const { callerIdentity: stranger } = await createAuthenticatedContext(auth, "owner");
    const { chfTx } = await pair(owner);
    const r = await run(stranger, (tx) => transactionHistory(tx, chfTx));
    expect(r.error?.code).toBe("NOT_FOUND");
  });
});

describe("lessons audit 23 — banking's read API", () => {
  it("outgoingMainRows: only outgoing rows of main accounts, newest first, with their base, capped", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, chf, sav, chfTx } = await pair(caller);
    await importFile(caller, sek, "nordea-2026-07-sek-sample.csv");
    await importFile(caller, sav, "nordea-savings-year.csv");
    const all = await run(caller, (tx) =>
      tx.bankTransaction.findMany({ include: { bankAccount: true } }),
    );
    const expected = all.filter((r) => r.amount.isNegative() && r.bankAccount.role === "main");
    expect(expected.length).toBeGreaterThan(3);
    expect(all.some((r) => r.bankAccountId === sav)).toBe(true);

    const rows = await run(caller, (tx) => outgoingMainRows(tx, 500));
    expect(rows.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
    expect(rows.every((r) => r.amount.startsWith("-"))).toBe(true);
    expect(rows.every((r) => r.bankAccountId === sek || r.bankAccountId === chf)).toBe(true);
    const dates = rows.map((r) => r.bookingDate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(rows.every((r) => r.amountBase !== null)).toBe(true);
    expect(rows.find((r) => r.id === chfTx)).toMatchObject({
      amount: "-20000.00",
      currency: "CHF",
      bookingDate: "2026-07-08",
      accountLabel: expect.stringContaining("CHF"),
    });

    const capped = await run(caller, (tx) => outgoingMainRows(tx, 2));
    expect(capped.map((r) => r.id)).toEqual(rows.slice(0, 2).map((r) => r.id));
  });

  it("bookingDates and firstBookingDate: by id, unknown ids absent; null before any import", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await setup(caller);
    expect(await run(caller, (tx) => firstBookingDate(tx))).toBeNull();
    expect((await run(caller, (tx) => bookingDates(tx, []))).size).toBe(0);

    await importFile(caller, ids.sav, "nordea-savings-year.csv");
    await importFile(caller, ids.chf, "nordea-transfer-pair-chf.csv");
    const chfTx = await run(caller, (tx) =>
      tx.bankTransaction.findFirstOrThrow({ where: { currency: "CHF" } }),
    );
    const unknown = "33333333-3333-4333-8333-333333333333";
    const dates = await run(caller, (tx) => bookingDates(tx, [chfTx.id, chfTx.id, unknown]));
    expect([...dates]).toEqual([[chfTx.id, "2026-07-08"]]);
    expect(await run(caller, (tx) => firstBookingDate(tx))).toBe("2026-01-02");

    // RLS: another tenant sees neither the dates nor a first booking
    const { callerIdentity: stranger } = await createAuthenticatedContext(auth, "owner");
    expect((await run(stranger, (tx) => bookingDates(tx, [chfTx.id]))).size).toBe(0);
    expect(await run(stranger, (tx) => firstBookingDate(tx))).toBeNull();
  });

  it("transactionStates: open, no document (flag or transfer leg), the facts with it; unknown absent; RLS", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, chfTx, sekTx } = await pair(caller);
    await importFile(caller, sek, "nordea-2026-07-sek-sample.csv");
    // two rows no rule marked (the bank-fee rule flags the fee rows of the sample)
    const [plain, flagged] = await run(caller, async (tx) => {
      const rows = await tx.bankTransaction.findMany({
        where: { currency: "SEK", id: { not: sekTx } },
        orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
      });
      const entries = await transactionFacts(
        tx,
        rows.map((r) => r.id),
      );
      return rows.filter((r) => entries.get(r.id)?.noDocumentNeeded === false).slice(0, 2);
    });
    expect((await run(caller, (tx) => transactionStates(tx, []))).size).toBe(0);

    await run(caller, async (tx) => {
      const entry = (await transactionFacts(tx, [flagged.id])).get(flagged.id);
      const r = await categorise(tx, caller, auditFor(tx, caller), entry?.id as string, {
        noDocumentNeeded: true,
      });
      expect(r.error).toBeUndefined();
      const a = await acceptTransfer(tx, caller, auditFor(tx, caller), {
        fromId: chfTx,
        toId: sekTx,
      });
      expect(a.error).toBeUndefined();
    });

    const unknown = "33333333-3333-4333-8333-333333333333";
    const states = await run(caller, (tx) =>
      transactionStates(tx, [plain.id, flagged.id, chfTx, sekTx, chfTx, unknown]),
    );
    expect(states.size).toBe(4);
    const nothing = {
      partnerId: null,
      partnerFrom: null,
      partnerName: null,
      basCode: null,
      basFrom: null,
      mixed: false,
    };
    expect(states.get(plain.id)).toEqual({
      state: "open",
      allocated: "0.00",
      inTransfer: false,
      ...nothing,
    });
    // flagged by hand without a partner: no proof · no partner (F129, D73)
    expect(states.get(flagged.id)).toEqual({
      state: "no_document_no_partner",
      allocated: "0.00",
      inTransfer: false,
      ...nothing,
    });
    for (const leg of [chfTx, sekTx])
      expect(states.get(leg)).toEqual({
        state: "no_document",
        allocated: "0.00",
        inTransfer: true,
        ...nothing,
      });

    // the same states the workbench list derives
    const list = await run(caller, (tx) =>
      listTransactions(tx, { page: 1, pageSize: 100, sort: [], filters: {} }),
    );
    for (const row of list.rows)
      if (states.has(row.id)) expect(states.get(row.id)?.state).toBe(row.state);

    const { callerIdentity: stranger } = await createAuthenticatedContext(auth, "owner");
    expect((await run(stranger, (tx) => transactionStates(tx, [plain.id, chfTx]))).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// F129 (D73 (a) = one-table US4): the proof's partner and account on read, whatever the link path
// ─────────────────────────────────────────────────────────────
describe("F129 — effective partner and category, derived on read", () => {
  /** the July sample on the SEK account, a supplier with its invoice of the SKATTEPUNKTEN row's amount, a group */
  async function scene(caller: CallerIdentity) {
    const ids = await setup(caller);
    await importFile(caller, ids.sek, "nordea-2026-07-sek-sample.csv");
    return run(caller, async (tx) => {
      await settings.activateBasCategories(tx, caller, auditFor(tx, caller), ["654", "653"]);
      await settings.updateBasPreference(tx, caller, auditFor(tx, caller), "654", {
        shortCode: "IT",
      });
      const supplier = await partners.createPartner(tx, caller, auditFor(tx, caller), {
        name: "Skattepunkten Office Services AB",
        types: ["vendor"],
        defaultCurrency: "SEK",
      });
      const group = await expenses.createGroup(tx, caller, auditFor(tx, caller), {
        description: "July 2026",
      });
      const row = await tx.bankTransaction.findFirstOrThrow({
        where: { bankAccountId: ids.sek, counterpartyKey: { startsWith: "SKATTEPUNKTEN" } },
      });
      const si = await supplierInvoices.createSupplierInvoice(tx, caller, auditFor(tx, caller), {
        groupId: group.data?.id as string,
        partnerId: supplier.data?.id as string,
        invoiceNumber: "2026-071",
        invoiceDate: "2026-07-06",
        currency: "SEK",
        amountNet: row.amount.abs().mul("0.8").toFixed(2),
        vatAmount: row.amount.abs().mul("0.2").toFixed(2),
        amountTotal: row.amount.abs().toFixed(2),
        basCode: "654",
        documentMissing: true,
      });
      if (si.error) throw new Error(si.error.message);
      return { ...ids, supplierId: supplier.data?.id as string, row: row.id, si: si.data.id };
    });
  }

  it("US1-1: a row paid through the supplier's own path shows its partner and account from the proof; nothing written, no categorisation in the trail", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const s = await scene(caller);
    const updateRows = async () =>
      Number(
        (
          await adminPool.query(
            `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND entity_type = 'bank_transaction' AND action = 'update'`,
            [caller.tenantId],
          )
        ).rows[0]?.count,
      );
    const updatesBefore = await updateRows();
    // the payment picker's path (D37): the module writes the link
    const paid = await run(caller, (tx) =>
      supplierInvoices.recordPayment(tx, caller, auditFor(tx, caller), {
        invoiceId: s.si,
        bankTransactionId: s.row,
      }),
    );
    expect(paid.error).toBeUndefined();
    await run(caller, async (tx) => {
      const list = await listTransactions(tx, {
        page: 1,
        pageSize: 50,
        sort: [],
        filters: { bankAccountId: { kind: "in", values: [s.sek] } },
      });
      const row = list.rows.find((r) => r.id === s.row);
      expect(row).toMatchObject({
        state: "linked",
        partnerId: s.supplierId,
        partnerName: "Skattepunkten Office Services AB",
        partnerFrom: "proof",
        basCode: "654",
        basFrom: "proof",
        mixed: false,
      });
      expect(row?.basLabel).toMatch(/^654 · /);
      const detail = await getTransaction(tx, s.row);
      expect(detail.data?.effective).toMatchObject({
        partnerId: s.supplierId,
        partnerName: "Skattepunkten Office Services AB",
        partnerFrom: "proof",
        basCode: "654",
        basFrom: "proof",
      });
      expect(detail.data?.state).toBe("linked");
      // the typed facts are untouched
      const stored = await tx.bankTransaction.findUniqueOrThrow({ where: { id: s.row } });
      expect(stored).toMatchObject({ partnerId: null, basCode: null, categorisedBy: null });
      const history = await transactionHistory(tx, s.row);
      expect(history.data?.map((e) => e.kind)).toEqual(["linked", "imported"]);
      expect((await transactionStates(tx, [s.row])).get(s.row)).toMatchObject({
        state: "linked",
        partnerId: s.supplierId,
        partnerName: "Skattepunkten Office Services AB",
        basCode: "654",
        partnerFrom: "proof",
        basFrom: "proof",
      });
      // the panel's Partner header filter and its distinct values run on the effective value
      const filtered = await listTransactions(tx, {
        page: 1,
        pageSize: 50,
        sort: [],
        filters: { partnerId: { kind: "in", values: [s.supplierId] } },
      });
      expect(filtered.rows.map((r) => r.id)).toEqual([s.row]);
      const distinct = await distinctTransactionValues(tx, "partnerId", {
        page: 1,
        pageSize: 50,
        sort: [],
        filters: {},
      });
      expect(distinct.find((d) => d.value === s.supplierId)?.count).toBe(1);
    });
    // SC-002: the derivation writes nothing — no bank_transaction update row when a link is made or removed
    expect(await updateRows()).toBe(updatesBefore);
    const removed = await run(caller, (tx) =>
      supplierInvoices.removePayment(tx, caller, auditFor(tx, caller), {
        invoiceId: s.si,
        linkId: paid.data?.linkId as string,
      }),
    );
    expect(removed.error).toBeUndefined();
    expect(await updateRows()).toBe(updatesBefore);
    await run(caller, async (tx) => {
      expect((await transactionStates(tx, [s.row])).get(s.row)).toMatchObject({
        state: "open",
        partnerId: null,
        basCode: null,
      });
    });
  });

  it("US1-2: a typed category wins (6530), the partner stays derived; the Suggestions path (applySuggestion) derives the same", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const s = await scene(caller);
    const applied = await run(caller, (tx) =>
      linking.applySuggestion(tx, caller, auditFor(tx, caller), {
        bankTransactionId: s.row,
        to: { type: "supplier_invoice", id: s.si },
      }),
    );
    expect(applied.error).toBeUndefined();
    await run(caller, async (tx) => {
      const typed = await categorise(tx, caller, auditFor(tx, caller), s.row, { basCode: "653" });
      expect(typed.error).toBeUndefined();
      const list = await listTransactions(tx, { page: 1, pageSize: 50, sort: [], filters: {} });
      expect(list.rows.find((r) => r.id === s.row)).toMatchObject({
        state: "linked",
        basCode: "653",
        basFrom: "row",
        partnerId: s.supplierId,
        partnerFrom: "proof",
      });
    });
  });

  it("US1-5: a plain document proof carries no partner — linked · no partner until the owner picks one; RLS", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const s = await scene(caller);
    const doc = await createTestDocument(adminPool, caller.tenantId, caller.userId, {
      status: "extracted",
    });
    const row = await run(caller, (tx) =>
      tx.bankTransaction.findUniqueOrThrow({ where: { id: s.row } }),
    );
    await adminPool.query(`UPDATE documents SET corrections = $2 WHERE id = $1`, [
      doc.id,
      JSON.stringify({ invoiceTotal: Number(row.amount.abs().toFixed(2)), currency: "SEK" }),
    ]);
    const link = await run(caller, (tx) =>
      linking.createLink(tx, caller, auditFor(tx, caller), {
        from: { type: "bank_transaction", id: s.row },
        to: { type: "document", id: doc.id },
        kind: "justifies",
        allocatedAmount: row.amount.abs().toFixed(2),
        currency: "SEK",
      }),
    );
    expect(link.error).toBeUndefined();
    await run(caller, async (tx) => {
      expect((await transactionStates(tx, [s.row])).get(s.row)).toMatchObject({
        state: "linked_no_partner",
        partnerId: null,
        partnerFrom: null,
        basCode: null,
      });
      const picked = await categorise(tx, caller, auditFor(tx, caller), s.row, {
        partnerId: s.supplierId,
      });
      expect(picked.error).toBeUndefined();
      expect((await transactionStates(tx, [s.row])).get(s.row)).toMatchObject({
        state: "linked",
        partnerFrom: "row",
      });
    });
    const { callerIdentity: stranger } = await createAuthenticatedContext(auth, "owner");
    expect((await run(stranger, (tx) => transactionStates(tx, [s.row]))).size).toBe(0);
  });
});
