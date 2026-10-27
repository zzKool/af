// Bank import — specs/banking/spec.md US1 (import, dedup, currency, errors, delete), US3 (transfer pairs),
// US4 (derived state), US5 (linkable) against the real database (RLS on), on the owner's fixtures.
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
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as linking from "@/modules/linking";
import { createBankAccount, updateBankAccount } from "./bank-accounts";
import { transactionFacts } from "./facts";
import { withImplicitRates } from "./implicit-rate";
import { deleteImport, importCsv } from "./import";
import {
  accountAliasesFor,
  accountCompleteness,
  getTransaction,
  listTransactions,
  transactionStates,
} from "./queries";
import { applyRules, createRule } from "./rules";
import { acceptTransfer, proposeTransfers } from "./transfer-pairs";
import type { BankTransactionDto } from "./types";

const FIXTURES = join(__dirname, "..", "..", "..", "specs", "banking", "fixtures");
const V2_FIXTURES = join(__dirname, "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

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
function realAudit(tx: TransactionClient, caller: CallerIdentity): AuditLogger {
  return { log: async (params) => createAuditEntry(tx, caller, params) };
}

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
  // ECB: 1 CHF = 11.10 / 0.9328 = 11.899657 SEK on 2026-07-08 (a Wednesday); June 30 for the fee rows
  await adminPool.query(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES
       ('2026-07-08', 'EUR/SEK', '11.1000'), ('2026-07-08', 'EUR/CHF', '0.9328'),
       ('2026-06-30', 'EUR/SEK', '11.0500'), ('2026-06-30', 'EUR/CHF', '0.9300')`,
  );
});
afterAll(async () => {
  await adminPool.end();
});

/** The owner's three accounts. */
async function accounts(caller: CallerIdentity) {
  return withTenantTransaction(prisma, caller.tenantId, async (tx) => {
    const sek = await createBankAccount(tx, caller, noopAudit, {
      accountAlias: "Plusgirokonto SEK",
      accountNumber: "123 45 67-8",
      currency: "SEK",
      bankFormatId: nordeaFormatId,
    });
    const chf = await createBankAccount(tx, caller, noopAudit, {
      accountAlias: "Plusgirokonto CHF",
      accountNumber: "123 45 67-8",
      currency: "CHF",
      bankFormatId: nordeaFormatId,
    });
    const sav = await createBankAccount(tx, caller, noopAudit, {
      accountAlias: "Sparkonto",
      accountNumber: "1234 56 78901",
      currency: "SEK",
      bankFormatId: nordeaFormatId,
      role: "savings",
    });
    return {
      sek: sek.data?.id as string,
      chf: chf.data?.id as string,
      sav: sav.data?.id as string,
    };
  });
}

const run = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

const importFile = (
  tx: TransactionClient,
  caller: CallerIdentity,
  bankAccountId: string,
  name: string,
  bytes = fixture(name),
) =>
  importCsv(tx, caller, realAudit(tx, caller), storage, { bankAccountId, fileName: name, bytes });

describe("US1 — import a month of Nordea rows", () => {
  it("scenario 1: the July sample → transactions verbatim, derived text, the base at rate 1", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const summary = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-2026-07-sek-sample.csv"),
    );
    expect(summary.error).toBeUndefined();
    const s = summary.data!;
    expect(s.errorCount).toBe(0);
    expect(s.duplicateCount).toBe(0);
    expect(s.importedCount).toBe(s.recordCount);
    expect(s.importedCount).toBeGreaterThan(10);
    expect(s.periodFrom).toBe("2026-07-03");
    expect(s.periodTo).toBe("2026-07-28");
    expect(s.accountLabel).toBe("Plusgirokonto SEK");
    expect(s.documentId).toBeTruthy();

    await run(caller, async (tx) => {
      const openai = await tx.bankTransaction.findFirst({
        where: { additionalDetails: { contains: "OPENAI" } },
      });
      expect(openai?.name).toBeNull();
      expect(openai?.description).toBe("Kortköp 260727 OPENAI *CHATGPT SUBS");
      expect(openai?.counterpartyKey).toBe("OPENAI *CHATGPT SUBS");
      expect(openai?.reference).toBe("OPENAI *CHATGPT 1234");
      expect(openai?.amount.toFixed(2)).toBe("-132.52");
      expect(openai?.currency).toBe("SEK");
      const entries = await transactionFacts(tx, [openai?.id as string]);
      const e = entries.get(openai?.id as string);
      expect(e?.amountBase).toBe("-132.52");
      expect(e?.rate).toBe("1");
      expect(e?.rateSource).toBe("same_currency");
      expect(e?.counterpartyKey).toBe("OPENAI *CHATGPT SUBS");
      // the stored statement
      const doc = await tx.document.findUnique({ where: { id: s.documentId as string } });
      expect(doc?.businessKey).toBe("Bank_Plusgirokonto-SEK_2026-07-03_2026-07-28.csv");
      expect(doc?.mimeType).toBe("text/csv");
      expect(doc?.status).toBe("generated");
      expect(doc?.prefixType).toBe("bank_statement");
    });
    await assertAuditLogged(adminPool, caller.tenantId, "create", "bank_import", s.id);
  });

  it("scenario 2: the same file again imports nothing; an overlapping later export imports only the new rows", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const first = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-2026-07-sek-sample.csv"),
    );
    const again = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-2026-07-sek-sample.csv"),
    );
    expect(again.data?.importedCount).toBe(0);
    expect(again.data?.duplicateCount).toBe(first.data?.recordCount);
    expect(again.data?.documentId).toBeTruthy(); // the file is stored anyway (the package needs it)

    // a later export: the last five July rows + three August rows (card rows without reference included)
    const text = new TextDecoder("ISO-8859-1").decode(fixture("nordea-2026-07-sek-sample.csv"));
    const lines = text.split(/\r?\n/).filter((l) => l !== "");
    const august = [
      "2026/08/03;-99,00;;;;Kortköp 260801 ANTHROPIC* CLAUDE SU;ANTHROPIC* CLAU 1234;;1234,56;SEK;",
      "2026/08/02;-85,00;;;AVGIFTER NORDEA;Priset for juli;;;;SEK;",
      "2026/08/01;25000,00;Client VA SA;;Client VA SA;;VA26-007;;5000,00;SEK;",
    ];
    const later = Buffer.from([lines[0], ...august, ...lines.slice(1, 6)].join("\n"), "latin1");
    const third = await run(caller, (tx) =>
      importFile(tx, caller, sek, "PLUSGIROKONTO FTG 123 45 67-8 - 2026-08-05 09.00.00.csv", later),
    );
    expect(third.data?.importedCount).toBe(3);
    expect(third.data?.duplicateCount).toBe(5);
    expect(third.data?.periodFrom).toBe(lines[5].slice(0, 10).replace(/\//g, "-"));
    expect(third.data?.periodTo).toBe("2026-08-03");
  });

  it("scenario 3: two identical fee rows are both imported (occurrence 0 and 1), the fee rule flags them", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const r = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-bank-fee-duplicate-rows.csv"),
    );
    expect(r.data?.importedCount).toBe(2);
    expect(r.data?.categorised).toBe(2); // the default rule, created on the first import
    const again = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-bank-fee-duplicate-rows.csv"),
    );
    expect(again.data?.importedCount).toBe(0);
    await run(caller, async (tx) => {
      const rows = await tx.bankTransaction.findMany({ orderBy: { rowIndex: "asc" } });
      expect(rows.map((t) => t.occurrence)).toEqual([0, 1]);
      expect(rows[0].dedupHash).toBe(rows[1].dedupHash);
      const entries = await transactionFacts(
        tx,
        rows.map((t) => t.id),
      );
      for (const t of rows) {
        const e = entries.get(t.id);
        expect(e?.basCode).toBe("657");
        expect(e?.noDocumentNeeded).toBe(true);
        expect(e?.categorisedBy).toBe("rule");
      }
      const rules = await tx.categorisationRule.findMany({ orderBy: { priority: "desc" } });
      expect(rules.map((x) => x.name)).toEqual(["Nordea bank fees", "Savings interest"]);
      expect(rules[0].hitCount).toBe(2);
      // derived: no document needed
      const list = await listTransactions(tx, { page: 1, pageSize: 10, sort: [], filters: {} });
      expect(list.rows.map((x) => x.state)).toEqual(["no_document", "no_document"]);
      expect(list.sums?.amount).toBe("-170.00");
      expect(list.sums?.amountBase).toBe("-170.00");
    });
  });

  it("scenario 4: a CHF row gets the ECB base of its booking date; no rate at all → refused, nothing written", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { chf } = await accounts(caller);
    const r = await run(caller, (tx) =>
      importFile(tx, caller, chf, "nordea-transfer-pair-chf.csv"),
    );
    expect(r.error).toBeUndefined();
    await run(caller, async (tx) => {
      const t = await tx.bankTransaction.findFirstOrThrow();
      const e = (await transactionFacts(tx, [t.id])).get(t.id);
      expect(e?.amount).toBe("-20000.00");
      expect(e?.currency).toBe("CHF");
      expect(e?.rate).toBe("11.899657");
      expect(e?.amountBase).toBe("-237993.14");
      expect(e?.rateSource).toBe("ecb_daily");
      expect(e?.rateDate).toBe("2026-07-08");
    });

    await adminPool.query("TRUNCATE ecb_rates");
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    const { chf: chf2 } = await accounts(other);
    const refused = await run(other, (tx) =>
      importFile(tx, other, chf2, "nordea-transfer-pair-chf.csv"),
    );
    expect(refused.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(refused.error?.message).toMatch(/No exchange rate for 2026-07-08/);
    await run(other, async (tx) => {
      expect(await tx.bankTransaction.count()).toBe(0);
      expect(await tx.bankImport.count()).toBe(0);
    });
  });

  it("scenario 5: a CHF file into the SEK account is refused; scenario 6: not a Nordea export / empty", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const wrong = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-transfer-pair-chf.csv"),
    );
    expect(wrong.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(wrong.error?.message).toBe(
      "Currency CHF in file does not match account Plusgirokonto SEK (SEK)",
    );
    const swedish = await run(caller, (tx) =>
      importFile(tx, caller, sek, "v1-swedish-headers.csv"),
    );
    expect(swedish.error?.code).toBe("VALIDATION_ERROR");
    expect(swedish.error?.message).toMatch(/^Not a Nordea export/);
    const empty = await run(caller, (tx) =>
      importFile(tx, caller, sek, "empty.csv", readFileSync(join(V2_FIXTURES, "nordea-empty.csv"))),
    );
    expect(empty.error?.message).toMatch(/empty/i);
    const headers = await run(caller, (tx) =>
      importFile(
        tx,
        caller,
        sek,
        "h.csv",
        readFileSync(join(V2_FIXTURES, "nordea-headers-only.csv")),
      ),
    );
    expect(headers.error?.message).toBe("No data rows found (headers only or empty)");
    await run(caller, async (tx) => expect(await tx.bankImport.count()).toBe(0));
  });

  it("scenario 7 (F109): a bad row refuses the whole file — every bad row named, nothing imported", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const bytes = Buffer.from(
      [
        "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;",
        "2026/07/08;-1 500,00;;;Something AB;;;;;SEK;",
        "2026/07/09;abc;;;Broken;;;;;SEK;",
        "2026/13/40;10,00;;;Bad date;;;;;SEK;",
      ].join("\n"),
      "latin1",
    );
    const r = await run(caller, (tx) => importFile(tx, caller, sek, "x.csv", bytes));
    expect(r.error?.code).toBe("VALIDATION_ERROR");
    expect(r.error?.message).toBe(
      '2 rows could not be read — Row 2: invalid amount "abc"; Row 3: invalid date "2026/13/40" — nothing was imported',
    );
    expect(r.error?.details).toEqual({
      errors: 'Row 2: invalid amount "abc"\nRow 3: invalid date "2026/13/40"',
      rows: 2,
    });
    await run(caller, async (tx) => {
      expect(await tx.bankTransaction.count()).toBe(0);
      expect(await tx.bankImport.count()).toBe(0);
      expect(await tx.document.count()).toBe(0); // the statement is not stored either
    });
  });

  it("scenario 9 + SC-005: an import is deleted with its entries unless a transaction is linked; no UPDATE ever", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const r = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-bank-fee-duplicate-rows.csv"),
    );
    const importId = r.data?.id as string;
    const ids = r.data?.transactionIds as string[];

    // the bank's facts and the base are written once: the trigger refuses (`bank_transactions_lock_facts`, F113)
    await expect(
      run(caller, (tx) =>
        tx.$executeRawUnsafe(`UPDATE bank_transactions SET amount = 1 WHERE id = '${ids[0]}'`),
      ),
    ).rejects.toThrow(/bank_transaction_locked/);
    await expect(
      run(caller, (tx) =>
        tx.$executeRawUnsafe(`UPDATE bank_transactions SET amount_base = 1 WHERE id = '${ids[0]}'`),
      ),
    ).rejects.toThrow(/bank_transaction_locked/);
    // the owner's facts change freely
    await run(caller, (tx) =>
      tx.$executeRawUnsafe(`UPDATE bank_transactions SET note = 'x' WHERE id = '${ids[0]}'`),
    );

    // link one → delete refused
    const doc = await adminPool.query(
      `INSERT INTO documents (tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type, document_type, status, created_by, updated_at)
       VALUES ($1, 'exp_x', 'x.pdf', 'https://x', 'application/pdf', 1, 'expense', 'financial', 'uploaded', $2, now()) RETURNING id`,
      [caller.tenantId, caller.userId],
    );
    const link = await run(caller, (tx) =>
      linking.createLink(tx, caller, noopAudit, {
        from: { type: "bank_transaction", id: ids[0] },
        to: { type: "document", id: doc.rows[0].id },
        kind: "justifies",
      }),
    );
    expect(link.error).toBeUndefined();
    const refused = await run(caller, (tx) => deleteImport(tx, caller, noopAudit, importId));
    expect(refused.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    await run(caller, (tx) => linking.removeLink(tx, caller, noopAudit, link.data?.id as string));
    const deleted = await run(caller, (tx) =>
      deleteImport(tx, caller, realAudit(tx, caller), importId),
    );
    expect(deleted.data?.deleted).toBe(2);
    await run(caller, async (tx) => {
      expect(await tx.bankTransaction.count()).toBe(0);
      expect(await tx.bankImport.count()).toBe(0);
    });
    await assertAuditLogged(adminPool, caller.tenantId, "delete", "bank_import", importId);
  });

  it("RLS: another tenant sees nothing of the import", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    await run(caller, (tx) => importFile(tx, caller, sek, "nordea-bank-fee-duplicate-rows.csv"));
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    await run(other, async (tx) => {
      expect(await tx.bankTransaction.count()).toBe(0);
      const list = await listTransactions(tx, { page: 1, pageSize: 10, sort: [], filters: {} });
      expect(list.total).toBe(0);
    });
  });
});

describe("F115 — completeness by balance", () => {
  it("the chain holds inside the June file; the July export that skipped a day reports one gap, the account is complete to June 28", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const june = await run(caller, (tx) => importFile(tx, caller, sek, "nordea-chain-2026-06.csv"));
    expect(june.error).toBeUndefined();
    expect(june.data).toMatchObject({ completeTo: "2026-06-28", balanceGaps: [], currency: "SEK" });

    const july = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-chain-2026-07-gap.csv"),
    );
    expect(july.error).toBeUndefined();
    // reported, never refused: the rows are in, the chain says −200.00 is missing between the exports
    expect(july.data?.importedCount).toBe(2);
    expect(july.data?.completeTo).toBe("2026-06-28");
    expect(july.data?.balanceGaps).toEqual([
      {
        from: "2026-06-28",
        to: "2026-07-10",
        expected: "10590.00",
        actual: "10390.00",
        difference: "-200.00",
      },
    ]);
    // the read API: the same chain per account; an account without rows is absent
    const chains = await run(caller, (tx) => accountCompleteness(tx));
    expect(chains.get(sek)).toMatchObject({ completeFrom: "2026-05-31", completeTo: "2026-06-28" });
    expect(chains.size).toBe(1);

    // the missing day arrives (a re-export of July from the 1st): the gap closes, complete to July 31
    const fixed = Buffer.from(
      [
        "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;",
        "2026/07/31;-300,00;;;;Kortköp 260730 HOTEL BERN;HOTEL 1234;;10090,00;SEK;",
        "2026/07/10;-10,00;;;;Kortköp 260709 COFFEE;COFFEE 1234;;10390,00;SEK;",
        "2026/07/03;-200,00;;;;Kortköp 260702 TRAIN SJ;SJ 1234;;10400,00;SEK;",
        "",
      ].join("\n"),
      "utf8",
    );
    const again = await run(caller, (tx) =>
      importFile(tx, caller, sek, "nordea-chain-2026-07-full.csv", fixed),
    );
    expect(again.data?.importedCount).toBe(1);
    expect(again.data?.balanceGaps).toEqual([]);
    expect(again.data?.completeTo).toBe("2026-07-31");
  });
});

describe("read API — accountAliasesFor", () => {
  it("each transaction's account label, the alias first, number + currency without one; another tenant's ids absent", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, chf } = await accounts(caller);
    await run(caller, (tx) => importFile(tx, caller, chf, "nordea-transfer-pair-chf.csv"));
    await run(caller, (tx) => importFile(tx, caller, sek, "nordea-transfer-pair-sek.csv"));
    await run(caller, (tx) =>
      updateBankAccount(tx, caller, noopAudit, sek, { accountAlias: null }),
    );
    const [chfTx, sekTx] = await run(caller, (tx) =>
      Promise.all([
        tx.bankTransaction.findFirstOrThrow({ where: { currency: "CHF" } }),
        tx.bankTransaction.findFirstOrThrow({ where: { currency: "SEK" } }),
      ]),
    );
    const labels = await run(caller, (tx) => accountAliasesFor(tx, [chfTx.id, sekTx.id]));
    expect(Object.fromEntries(labels)).toEqual({
      [chfTx.id]: "Plusgirokonto CHF",
      [sekTx.id]: "123 45 67-8 SEK",
    });
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    expect((await run(other, (tx) => accountAliasesFor(tx, [chfTx.id]))).size).toBe(0);
    expect((await run(caller, (tx) => accountAliasesFor(tx, []))).size).toBe(0);
  });
});

describe("US3 — the CHANGE CHFSEK transfer pair", () => {
  async function pair(caller: CallerIdentity) {
    const { sek, chf, sav } = await accounts(caller);
    await run(caller, (tx) => importFile(tx, caller, chf, "nordea-transfer-pair-chf.csv"));
    await run(caller, (tx) => importFile(tx, caller, sek, "nordea-transfer-pair-sek.csv"));
    const [a, b] = await run(caller, (tx) =>
      Promise.all([
        tx.bankTransaction.findFirstOrThrow({ where: { currency: "CHF" } }),
        tx.bankTransaction.findFirstOrThrow({ where: { currency: "SEK" } }),
      ]),
    );
    return { sek, chf, sav, chfTx: a.id, sekTx: b.id };
  }

  it("scenario 1 + 2: proposed with implied 11.887, accepted into one link and the implicit rate — no flag typed", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { chfTx, sekTx } = await pair(caller);
    const proposals = await run(caller, (tx) => proposeTransfers(tx, chfTx));
    expect(proposals.data).toHaveLength(1);
    const p = proposals.data![0];
    expect(p.from.id).toBe(chfTx);
    expect(p.to.id).toBe(sekTx);
    expect(p.implied).toBe("11.887000");
    expect(p.ecb).toBe("11.899657");
    expect(p.deviationPercent).toBe("0.11");
    expect(p.hints).toEqual(expect.arrayContaining(["CHANGE", "CHFSEK", "account"]));
    // from the SEK side the same pair comes back
    const back = await run(caller, (tx) => proposeTransfers(tx, sekTx));
    expect(back.data?.[0].from.id).toBe(chfTx);

    const accepted = await run(caller, (tx) =>
      acceptTransfer(tx, caller, realAudit(tx, caller), { fromId: chfTx, toId: sekTx }),
    );
    expect(accepted.error).toBeUndefined();
    expect(accepted.data?.implied).toBe("11.887000");
    await run(caller, async (tx) => {
      const links = await linking.getLinksFor(tx, { type: "bank_transaction", id: chfTx });
      expect(links.data).toHaveLength(1);
      expect(links.data?.[0].kind).toBe("transfer");
      expect(links.data?.[0].to.id).toBe(sekTx);
      const entries = new Map(
        (
          await withImplicitRates(tx, [...(await transactionFacts(tx, [chfTx, sekTx])).values()])
        ).map((r) => [r.id, r]),
      );
      const chfEntry = entries.get(chfTx);
      const sekEntry = entries.get(sekTx);
      // F65: the legs' facts are untouched — "transfer" is the link, the state derives from it
      expect(chfEntry?.noDocumentNeeded).toBe(false);
      expect(sekEntry?.noDocumentNeeded).toBe(false);
      expect(chfEntry?.categorisedBy).toBeNull();
      expect(sekEntry?.categorisedBy).toBeNull();
      expect(chfEntry?.bankImplicitRate).toBe("11.887");
      expect(chfEntry?.rate).toBe("11.899657"); // ECB stays the rate of the base
      expect(chfEntry?.amountBase).toBe("-237993.14");
      expect(sekEntry?.bankImplicitRate).toBeNull();
      // derived state
      const d = await getTransaction(tx, chfTx);
      expect(d.data?.state).toBe("no_document");
      expect(d.data?.links[0].otherLabel).toMatch(/237740\.00 SEK/);
      // no second proposal, no second acceptance
      expect((await proposeTransfers(tx, chfTx)).data).toHaveLength(0);
    });
    const twice = await run(caller, (tx) =>
      acceptTransfer(tx, caller, noopAudit, { fromId: chfTx, toId: sekTx }),
    );
    expect(twice.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    await assertAuditLogged(
      adminPool,
      caller.tenantId,
      "create",
      "link",
      accepted.data?.linkId as string,
    );
  });

  it("scenario 3: a savings move pairs at rate 1; scenario 4: pair then unpair leaves the rows as before", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, sav } = await accounts(caller);
    await run(caller, (tx) => importFile(tx, caller, sav, "nordea-savings-year.csv"));
    const out = Buffer.from(
      [
        "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;",
        "2025/12/31;-50000,00;;1234 56 78901;TRANSFER TO OWN ACCOUNT;;;;100,00;SEK;",
      ].join("\n"),
      "latin1",
    );
    await run(caller, (tx) => importFile(tx, caller, sek, "out.csv", out));
    const { inn, outTx, interest } = await run(caller, async (tx) => ({
      inn: await tx.bankTransaction.findFirstOrThrow({ where: { amount: 50000 } }),
      outTx: await tx.bankTransaction.findFirstOrThrow({ where: { amount: -50000 } }),
      interest: await tx.bankTransaction.findFirstOrThrow({
        where: { additionalDetails: { startsWith: "Ranta" } },
      }),
    }));
    const ids = [inn.id, outTx.id];
    const facts = (tx: TransactionClient) =>
      transactionFacts(tx, ids).then((m) =>
        ids.map((id) => {
          const e = m.get(id);
          return {
            basCode: e?.basCode,
            partnerId: e?.partnerId,
            note: e?.note,
            noDocumentNeeded: e?.noDocumentNeeded,
            categorisedBy: e?.categorisedBy,
            ruleId: e?.ruleId,
          };
        }),
      );
    const before = await run(caller, facts);
    const statesBefore = await run(caller, (tx) =>
      Promise.all(ids.map(async (id) => (await getTransaction(tx, id)).data?.state)),
    );
    expect(statesBefore).toEqual(["open", "open"]);

    const proposals = await run(caller, (tx) => proposeTransfers(tx, inn.id));
    expect(proposals.data).toHaveLength(1);
    expect(proposals.data?.[0].implied).toBe("1.000000");
    expect(proposals.data?.[0].from.id).toBe(outTx.id);
    const accepted = await run(caller, (tx) =>
      acceptTransfer(tx, caller, noopAudit, { fromId: inn.id, toId: outTx.id }),
    );
    expect(accepted.error).toBeUndefined();
    await run(caller, async (tx) => {
      const entries = await transactionFacts(tx, [inn.id, interest.id]);
      const [innRow] = await withImplicitRates(tx, [entries.get(inn.id) as BankTransactionDto]);
      expect(innRow?.bankImplicitRate).toBeNull(); // same currency: nothing to record
      // the interest row hit the default rule (regex on the details)
      expect(entries.get(interest.id)?.basCode).toBe("831");
      expect(entries.get(interest.id)?.noDocumentNeeded).toBe(true);
      // paired: the facts are as before, the state derives from the link
      expect(await facts(tx)).toEqual(before);
      expect((await getTransaction(tx, inn.id)).data?.state).toBe("no_document");
      expect((await getTransaction(tx, outTx.id)).data?.state).toBe("no_document");
      await linking.removeLink(tx, caller, noopAudit, accepted.data?.linkId as string);
    });
    // unpaired: the rows are exactly as before the pair
    expect(await run(caller, facts)).toEqual(before);
    const statesAfter = await run(caller, (tx) =>
      Promise.all(ids.map(async (id) => (await getTransaction(tx, id)).data?.state)),
    );
    expect(statesAfter).toEqual(statesBefore);
  });

  it("F65: a rule applies to an accepted transfer leg (the pair no longer marks it 'by hand')", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { chfTx, sekTx } = await pair(caller);
    const accepted = await run(caller, (tx) =>
      acceptTransfer(tx, caller, noopAudit, { fromId: chfTx, toId: sekTx }),
    );
    expect(accepted.error).toBeUndefined();
    const rule = await run(caller, (tx) =>
      createRule(tx, caller, noopAudit, {
        name: "Currency exchange",
        matchType: "contains",
        matchPattern: "CHANGE CHFSEK",
        matchField: "details",
        basCode: "657",
      }),
    );
    expect(rule.error).toBeUndefined();
    const applied = await run(caller, (tx) => applyRules(tx, caller, noopAudit));
    expect(applied.error).toBeUndefined();
    expect(applied.data?.applied).toBeGreaterThanOrEqual(1);
    await run(caller, async (tx) => {
      const [chfEntry] = await withImplicitRates(tx, [
        (await transactionFacts(tx, [chfTx])).get(chfTx) as BankTransactionDto,
      ]);
      expect(chfEntry?.basCode).toBe("657");
      expect(chfEntry?.categorisedBy).toBe("rule");
      expect(chfEntry?.ruleId).toBe(rule.data?.id);
      expect(chfEntry?.bankImplicitRate).toBe("11.887"); // the pair's own fact is untouched
    });
  });
  it("lessons 32: a SEK row meeting a CHF and a EUR candidate compares each with its own ECB rate", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, chf } = await accounts(caller);
    const eur = await run(caller, (tx) =>
      createBankAccount(tx, caller, noopAudit, {
        accountAlias: "Konto EUR",
        accountNumber: "9999 88 77",
        currency: "EUR",
        bankFormatId: nordeaFormatId,
      }),
    );
    const csv = (amount: string, currency: string) =>
      Buffer.from(
        [
          "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;",
          `2026/07/08;${amount};;;EXCHANGE;;;;100,00;${currency};`,
        ].join("\n"),
        "latin1",
      );
    // ECB 2026-07-08: 1 CHF = 11.899657 SEK, 1 EUR = 11.10 SEK; 22 200 SEK out, 1 865.60 CHF and 2 000 EUR in
    await run(caller, (tx) => importFile(tx, caller, sek, "sek.csv", csv("-22200,00", "SEK")));
    await run(caller, (tx) => importFile(tx, caller, chf, "chf.csv", csv("1865,60", "CHF")));
    await run(caller, (tx) =>
      importFile(tx, caller, eur.data?.id as string, "eur.csv", csv("2000,00", "EUR")),
    );
    const out = await run(caller, (tx) =>
      tx.bankTransaction.findFirstOrThrow({ where: { currency: "SEK" } }),
    );
    const proposals = await run(caller, (tx) => proposeTransfers(tx, out.id));
    const byCurrency = new Map((proposals.data ?? []).map((p) => [p.to.currency, p]));
    expect([...byCurrency.keys()].sort()).toEqual(["CHF", "EUR"]);
    expect(byCurrency.get("CHF")?.ecb).toBe("11.899657");
    expect(byCurrency.get("CHF")?.implied).toBe("11.899657");
    expect(byCurrency.get("EUR")?.ecb).toBe("11.100000");
    expect(byCurrency.get("EUR")?.implied).toBe("11.100000");
  });
});

describe("F65 — an account's number and currency are locked once a CSV is imported into it", () => {
  it("changing the currency or the number of an imported account is refused; the alias still changes", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek, chf } = await accounts(caller);
    // before any import both change freely (and back)
    const free = await run(caller, (tx) =>
      updateBankAccount(tx, caller, noopAudit, sek, { currency: "EUR" }),
    );
    expect(free.error).toBeUndefined();
    await run(caller, (tx) => updateBankAccount(tx, caller, noopAudit, sek, { currency: "SEK" }));

    await run(caller, (tx) => importFile(tx, caller, chf, "nordea-transfer-pair-chf.csv"));
    const currency = await run(caller, (tx) =>
      updateBankAccount(tx, caller, noopAudit, chf, { currency: "EUR" }),
    );
    expect(currency.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(currency.error?.details).toEqual({ imports: 1 });
    const number = await run(caller, (tx) =>
      updateBankAccount(tx, caller, noopAudit, chf, { accountNumber: "999 99 99-9" }),
    );
    expect(number.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    // the same values, the alias, the IBAN: still fine
    const same = await run(caller, (tx) =>
      updateBankAccount(tx, caller, noopAudit, chf, {
        currency: "CHF",
        accountNumber: "123 45 67-8",
        accountAlias: "CHF main",
        iban: "SE0000000000000000000000",
      }),
    );
    expect(same.error).toBeUndefined();
    const row = await run(caller, (tx) => tx.bankAccount.findUniqueOrThrow({ where: { id: chf } }));
    expect(row).toMatchObject({
      currency: "CHF",
      accountNumber: "123 45 67-8",
      accountAlias: "CHF main",
    });
  });
});

describe("US4 / US5 — derived state and the allocation invariant", () => {
  it("open → partial → linked from allocations; Σ from one transaction never exceeds its amount", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await accounts(caller);
    const bytes = Buffer.from(
      [
        "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;",
        "2026/07/08;-1000,00;;;Some Vendor AB;;;;;SEK;",
      ].join("\n"),
      "latin1",
    );
    const r = await run(caller, (tx) => importFile(tx, caller, sek, "v.csv", bytes));
    const txId = r.data?.transactionIds[0] as string;
    const docs = await adminPool.query(
      `INSERT INTO documents (tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type, document_type, status, created_by, updated_at)
       VALUES ($1, 'exp_a', 'a.pdf', 'https://a', 'application/pdf', 1, 'expense', 'financial', 'uploaded', $2, now()),
              ($1, 'exp_b', 'b.pdf', 'https://b', 'application/pdf', 1, 'expense', 'financial', 'uploaded', $2, now()) RETURNING id`,
      [caller.tenantId, caller.userId],
    );
    const [docA, docB] = docs.rows.map((x) => x.id as string);
    // documents carry no amount → a link without allocation; the transaction is "linked" only by amount, so still open
    await run(caller, async (tx) => {
      expect((await getTransaction(tx, txId)).data?.state).toBe("open");
    });
    // a fake invoice-like target: use a manual journal entry of 1 000 SEK as the allocation target? No — targets of
    // `justifies` are documents / invoices / supplier invoices / expenses. Use an issued invoice.
    const invoiceId = await createIssuedInvoice(caller, "1000.00");
    const part = await run(caller, (tx) =>
      linking.createLink(tx, caller, noopAudit, {
        from: { type: "bank_transaction", id: txId },
        to: { type: "invoice", id: invoiceId },
        kind: "justifies",
        allocatedAmount: "400.00",
        currency: "SEK",
      }),
    );
    expect(part.error).toBeUndefined();
    await run(caller, async (tx) => {
      const d = await getTransaction(tx, txId);
      expect(d.data?.state).toBe("partial");
      expect(d.data?.allocated).toBe("400.00");
      // the read API other modules call gives the same state and facts (lessons audit 23)
      expect((await transactionStates(tx, [txId])).get(txId)).toEqual({
        state: "partial",
        allocated: "400.00",
        inTransfer: false,
      });
    });
    const bigger = await createIssuedInvoice(caller, "700.00");
    const over = await run(caller, (tx) =>
      linking.createLink(tx, caller, noopAudit, {
        from: { type: "bank_transaction", id: txId },
        to: { type: "invoice", id: bigger },
        kind: "justifies",
        allocatedAmount: "601.00",
        currency: "SEK",
      }),
    );
    expect(over.error?.message).toMatch(/would exceed its amount/);
    const rest = await run(caller, (tx) =>
      linking.createLink(tx, caller, noopAudit, {
        from: { type: "bank_transaction", id: txId },
        to: { type: "invoice", id: invoiceId },
        kind: "justifies",
        allocatedAmount: "599.96", // within the tolerance of 0.05
        currency: "SEK",
        note: "second",
      }),
    );
    expect(rest.error?.code).toBe("DUPLICATE_ENTRY"); // same tuple — one link per (from, to, kind)
    const second = await createIssuedInvoice(caller, "600.00");
    const ok = await run(caller, (tx) =>
      linking.createLink(tx, caller, noopAudit, {
        from: { type: "bank_transaction", id: txId },
        to: { type: "invoice", id: second },
        kind: "justifies",
        allocatedAmount: "599.96",
        currency: "SEK",
      }),
    );
    expect(ok.error).toBeUndefined();
    await run(caller, async (tx) => {
      expect((await getTransaction(tx, txId)).data?.state).toBe("linked");
      expect((await transactionStates(tx, [txId])).get(txId)).toEqual({
        state: "linked",
        allocated: "999.96",
        inTransfer: false,
      });
      const list = await listTransactions(tx, {
        page: 1,
        pageSize: 10,
        sort: [],
        filters: { state: { kind: "in", values: ["linked"] } },
      });
      expect(list.total).toBe(1);
    });
    void docA;
    void docB;
  });
});

/** An issued SEK invoice of `total` for a fresh client (through the invoices module). */
async function createIssuedInvoice(caller: CallerIdentity, total: string): Promise<string> {
  const invoices = await import("@/modules/invoices");
  const partners = await import("@/modules/partners");
  return run(caller, async (tx) => {
    const short = `C${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const partner = await partners.createPartner(tx, caller, noopAudit, {
      name: `Client ${short}`,
      types: ["client"],
      shortCode: short,
      defaultCurrency: "SEK",
    });
    const draft = await invoices.createDraft(tx, caller, noopAudit, "2026-07-01", {
      type: "invoice",
      partnerId: partner.data?.id as string,
      issueDate: "2026-07-01",
      lines: [{ description: "Work", quantity: "1", unit: "day", unitPrice: total, vatRate: "0" }],
    });
    if (draft.error) throw new Error(draft.error.message);
    const issued = await invoices.issue(tx, caller, noopAudit, new Date("2026-07-01T10:00:00Z"), {
      id: draft.data.id,
    });
    if (issued.error) throw new Error(issued.error.message);
    return issued.data.id;
  });
}
