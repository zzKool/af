// The Months panel's read model (F69) against the real database (RLS on): a month with a transfer pair, a month no
// import covers, the banner while the month's package is not built — and gone once it is.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import { createBankAccount } from "./bank-accounts";
import { importCsv } from "./import";
import { rowsToJustifyCount } from "./open-work";
import { listTransactions } from "./queries";
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
const noopAudit: AuditLogger = { log: async () => {} };

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
      createBankAccount(tx, caller, noopAudit, {
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

const importFile = (caller: CallerIdentity, bankAccountId: string, name: string) =>
  run(caller, (tx) =>
    importCsv(tx, caller, noopAudit, storage, {
      bankAccountId,
      fileName: name,
      bytes: readFileSync(join(FIXTURES, name)),
    }),
  );

/** The CHANGE CHFSEK pair of 2026-07-08, imported (not yet accepted). */
async function pair(caller: CallerIdentity) {
  const ids = await setup(caller);
  expect((await importFile(caller, ids.chf, "nordea-transfer-pair-chf.csv")).error).toBeUndefined();
  expect((await importFile(caller, ids.sek, "nordea-transfer-pair-sek.csv")).error).toBeUndefined();
  const [chfTx, sekTx] = await run(caller, (tx) =>
    Promise.all([
      tx.bankTransaction.findFirstOrThrow({ where: { currency: "CHF" } }),
      tx.bankTransaction.findFirstOrThrow({ where: { currency: "SEK" } }),
    ]),
  );
  return { ...ids, chfTx: chfTx.id, sekTx: sekTx.id };
}

/** what the workbench and the dashboard count: the main accounts' open | partial rows, through the full list */
async function listedToJustify(caller: CallerIdentity, mainIds: string[]) {
  const r = await run(caller, (tx) =>
    listTransactions(tx, {
      filters: {
        state: { kind: "in", values: ["open", "partial"] },
        bankAccountId: { kind: "in", values: mainIds },
      },
      sort: [],
      page: 1,
      pageSize: 1,
      search: "",
    }),
  );
  return r.total;
}

describe("F72 — rowsToJustifyCount, the sidebar's Banking count", () => {
  it("counts the main accounts' rows to justify — the list's number; a fee row (no document) and the savings account are out", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await setup(caller);
    expect(await run(caller, rowsToJustifyCount)).toBe(0);
    expect(
      (await importFile(caller, ids.sek, "nordea-2026-07-sek-sample.csv")).error,
    ).toBeUndefined();
    expect((await importFile(caller, ids.sav, "nordea-savings-year.csv")).error).toBeUndefined();
    const count = await run(caller, rowsToJustifyCount);
    expect(count).toBe(await listedToJustify(caller, [ids.sek, ids.chf]));
    expect(count).toBe(11); // 12 rows, AVGIFTER NORDEA categorised "no document" by the default rule
  });

  it("an accepted transfer pair leaves the count; RLS: another tenant counts nothing", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, chf, chfTx, sekTx } = await pair(caller);
    expect(await run(caller, rowsToJustifyCount)).toBe(2);
    await run(caller, (tx) =>
      acceptTransfer(tx, caller, noopAudit, { fromId: chfTx, toId: sekTx }),
    );
    expect(await run(caller, rowsToJustifyCount)).toBe(0);
    expect(await listedToJustify(caller, [sek, chf])).toBe(0);
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    await pair(other);
    expect(await run(caller, rowsToJustifyCount)).toBe(0);
  });
});
