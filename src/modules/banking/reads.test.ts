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
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import { createBankAccount } from "./bank-accounts";
import { categorise, transactionFacts } from "./facts";
import { transactionHistory } from "./history";
import { importCsv } from "./import";
import {
  bookingDates,
  firstBookingDate,
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
    expect(states.get(plain.id)).toEqual({ state: "open", allocated: "0.00", inTransfer: false });
    expect(states.get(flagged.id)).toEqual({
      state: "no_document",
      allocated: "0.00",
      inTransfer: false,
    });
    for (const leg of [chfTx, sekTx])
      expect(states.get(leg)).toEqual({
        state: "no_document",
        allocated: "0.00",
        inTransfer: true,
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
