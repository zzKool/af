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
import * as accountantPackage from "@/modules/package";
import { createBankAccount } from "./bank-accounts";
import { importCsv } from "./import";
import { bankMonths } from "./months";
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

const AUGUST = { today: "2026-08-15" };

describe("F69 — the Months read model", () => {
  it("a month with a transfer pair: both legs to justify, then both justified once the pair is accepted", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, chf, chfTx, sekTx } = await pair(caller);

    const before = await run(caller, (tx) => bankMonths(tx, AUGUST));
    expect(before.months).toHaveLength(12);
    expect(before.from).toBe("2025-09");
    expect(before.to).toBe("2026-08");
    expect(before.months.find((m) => m.month === "2026-07")).toEqual({
      month: "2026-07",
      justified: 0,
      toJustify: 2,
      built: false,
    });
    const july = (o: typeof before, account: string) =>
      o.cells.find((c) => c.bankAccountId === account && c.month === "2026-07");
    expect(july(before, chf)).toMatchObject({ state: "open", rows: 1, toJustify: 1 });
    expect(july(before, sek)).toMatchObject({ state: "open", rows: 1, toJustify: 1 });

    await run(caller, (tx) =>
      acceptTransfer(tx, caller, noopAudit, { fromId: chfTx, toId: sekTx }),
    );
    const after = await run(caller, (tx) => bankMonths(tx, AUGUST));
    expect(after.months.find((m) => m.month === "2026-07")).toMatchObject({
      justified: 2,
      toJustify: 0,
    });
    expect(july(after, chf)?.state).toBe("proven");
    expect(july(after, sek)?.state).toBe("proven");
  });

  it("not imported: an account no import covers, and the months around an import; an import's period counts without rows", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, sav } = await pair(caller);

    const o = await run(caller, (tx) => bankMonths(tx, AUGUST));
    // the savings account has no import at all → every month not imported
    expect(o.cells.filter((c) => c.bankAccountId === sav).map((c) => c.state)).toEqual(
      Array(12).fill("not_imported"),
    );
    // SEK: only July (the pair file's period)
    const sekCells = o.cells.filter((c) => c.bankAccountId === sek);
    expect(sekCells.find((c) => c.month === "2026-06")?.state).toBe("not_imported");
    expect(sekCells.find((c) => c.month === "2026-08")?.state).toBe("not_imported");
    expect(o.accounts.map((a) => a.label)).toEqual(
      expect.arrayContaining(["Plusgirokonto SEK", "Plusgirokonto CHF", "Sparkonto"]),
    );

    // the savings year file: 2026-01-02 → 2026-12-31 — every month between is imported, rows or not
    expect((await importFile(caller, sav, "nordea-savings-year.csv")).error).toBeUndefined();
    const withSavings = await run(caller, (tx) => bankMonths(tx, AUGUST));
    const savCells = withSavings.cells.filter((c) => c.bankAccountId === sav);
    expect(savCells.find((c) => c.month === "2026-05")).toMatchObject({ state: "proven", rows: 0 });
    expect(savCells.find((c) => c.month === "2025-12")?.state).toBe("not_imported");
  });

  it("the banner: July's rows without proof while its package is not built; gone once it is", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await pair(caller);

    const open = await run(caller, (tx) => bankMonths(tx, AUGUST));
    expect(open.banner).toEqual({ month: "2026-07", withoutProof: 2 });
    // the running month is never the banner's: in July itself there is no closed month with rows
    expect((await run(caller, (tx) => bankMonths(tx, { today: "2026-07-20" }))).banner).toBeNull();

    // a queued build is not a built package
    const requested = await run(caller, (tx) =>
      accountantPackage.requestBuild(tx, caller, noopAudit, { period: "2026-07" }),
    );
    const buildId = requested.data?.id as string;
    expect((await run(caller, (tx) => bankMonths(tx, AUGUST))).banner?.month).toBe("2026-07");

    await run(caller, async (tx) => {
      await accountantPackage.markBuilding(tx, buildId);
      await accountantPackage.markBuilt(tx, noopAudit, buildId, {
        documentId: crypto.randomUUID(),
        counts: accountantPackage.EMPTY_COUNTS,
        flags: 0,
        notes: "",
        builtAt: new Date("2026-08-02T10:00:00Z"),
      });
    });
    const built = await run(caller, (tx) => bankMonths(tx, AUGUST));
    expect(built.banner).toBeNull();
    expect(built.months.find((m) => m.month === "2026-07")?.built).toBe(true);
  });

  it("the window runs from the first imported month (at least a year back) to today's month; RLS: another tenant sees none of it", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sav } = await pair(caller);
    // a year after: the pair's July is the first month
    const later = await run(caller, (tx) => bankMonths(tx, { today: "2027-08-03" }));
    expect([later.from, later.to, later.months.length]).toEqual(["2026-07", "2027-08", 14]);
    // the savings year file starts 2026-01-02 — the window reaches back to it
    expect((await importFile(caller, sav, "nordea-savings-year.csv")).error).toBeUndefined();
    const withSavings = await run(caller, (tx) => bankMonths(tx, { today: "2027-08-03" }));
    expect(withSavings.from).toBe("2026-01");

    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    const theirs = await run(other, (tx) => bankMonths(tx, AUGUST));
    expect(theirs.accounts).toEqual([]);
    expect(theirs.months.every((m) => m.justified + m.toJustify === 0)).toBe(true);
    expect(theirs.banner).toBeNull();
  });
});
