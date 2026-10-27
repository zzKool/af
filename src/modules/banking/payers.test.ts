// The payers (F114, D60, specs/linking/payment-record.md US4): the accounts an expense can name — the main accounts
// and the owner's private instruments, never savings; a private instrument is made only by `createPrivateAccount`,
// has no format and takes no statement.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import { createBankAccount } from "./bank-accounts";
import { importCsv } from "./import";
import { createPrivateAccount, payerAccount, payerAccounts } from "./payers";

const noopAudit: AuditLogger = { log: async () => {} };
// never reached: a private instrument is refused before any blob is written
const storage = {} as StorageService;
const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
});
afterAll(async () => {
  await adminPool.end();
});

async function nordeaFormatId(): Promise<string> {
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  return r.rows[0].id;
}

describe("payers (F114)", () => {
  it("the main accounts first (bank_account), then the private instruments (private); savings pay nothing", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const caller = owner.callerIdentity;
    const formatId = await nordeaFormatId();
    const payers = await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      for (const [alias, number, currency, role] of [
        ["Savings", "9999", "SEK", "savings"],
        ["Plusgirokonto SEK", "1234", "SEK", "main"],
        ["Plusgirokonto CHF", "1234", "CHF", "main"],
      ] as const) {
        const r = await createBankAccount(tx, caller, noopAudit, {
          accountAlias: alias,
          accountNumber: number,
          currency,
          bankFormatId: formatId,
          role,
        });
        expect(r.error).toBeUndefined();
      }
      const ch = await createPrivateAccount(tx, caller, noopAudit, {
        alias: "Private CH",
        currency: "CHF",
      });
      expect(ch.error).toBeUndefined();
      expect(ch.data).toMatchObject({ label: "Private CH", currency: "CHF", kind: "private" });
      const se = await createPrivateAccount(tx, caller, noopAudit, {
        alias: "Private SE",
        currency: "SEK",
      });
      expect(se.error).toBeUndefined();
      return payerAccounts(tx);
    });
    expect(payers.map((p) => [p.label, p.kind])).toEqual([
      ["Plusgirokonto CHF", "bank_account"],
      ["Plusgirokonto SEK", "bank_account"],
      ["Private CH", "private"],
      ["Private SE", "private"],
    ]);
  });

  it("a private instrument: the alias is its number, no format; a duplicate is refused; no statement to import; not a role the account form takes", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const caller = owner.callerIdentity;
    const formatId = await nordeaFormatId();
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const made = await createPrivateAccount(tx, caller, noopAudit, {
        alias: "Private SE",
        currency: "SEK",
      });
      expect(made.error).toBeUndefined();
      const row = await tx.bankAccount.findUniqueOrThrow({ where: { id: made.data?.id } });
      expect(row).toMatchObject({
        accountAlias: "Private SE",
        accountNumber: "Private SE",
        bankFormatId: null,
        role: "owner_private",
      });
      expect(await payerAccount(tx, row.id)).toMatchObject({ kind: "private", currency: "SEK" });

      const again = await createPrivateAccount(tx, caller, noopAudit, {
        alias: " Private SE ",
        currency: "SEK",
      });
      expect(again.error?.code).toBe("DUPLICATE_ENTRY");

      const imported = await importCsv(tx, caller, noopAudit, storage, {
        bankAccountId: row.id,
        fileName: "private.csv",
        bytes: Buffer.from("Bokföringsdag;Belopp\n2026-07-01;-10,00\n"),
      });
      expect(imported.error?.message).toMatch(/private instrument/);

      // the statement-account form never makes one: the role is not its to set
      const viaForm = await createBankAccount(tx, caller, noopAudit, {
        accountAlias: "Not this way",
        accountNumber: "0000",
        currency: "SEK",
        bankFormatId: formatId,
        role: "owner_private",
      });
      expect(viaForm.error?.code).toBe("VALIDATION_ERROR");

      // the database half: a statement role needs a format
      await expect(
        tx.$executeRaw`UPDATE bank_accounts SET role = 'main' WHERE id = ${row.id}::uuid`,
      ).rejects.toThrow(/bank_accounts_format_check/);
    });
  });

  it("a savings account is no payer", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const caller = owner.callerIdentity;
    const formatId = await nordeaFormatId();
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const r = await createBankAccount(tx, caller, noopAudit, {
        accountAlias: "Savings",
        accountNumber: "9999",
        currency: "SEK",
        bankFormatId: formatId,
        role: "savings",
      });
      expect(await payerAccount(tx, r.data?.id ?? "")).toBeNull();
    });
  });
});
