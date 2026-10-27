// Shared setup of the expenses DB tests: the owner's accounts, BAS aliases, payment sources, fixture ECB rates,
// a Nordea CSV built from rows (so settlements and attachments run on real bank transactions).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { vi } from "vitest";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import { createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import * as banking from "@/modules/banking";
import * as settings from "@/modules/settings";

export const FIXTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "specs",
      "expenses",
      "fixtures",
      "owner-flow-settlement.json",
    ),
    "utf8",
  ),
);

export const storage: StorageService = {
  ensureContainer: vi.fn(async () => {}),
  uploadBlob: vi.fn(async (path: string) => `https://blob.test/documents/${path}`),
  downloadBlob: vi.fn(),
  deleteBlob: vi.fn(),
  generateSasUrl: vi.fn(),
  generateDownloadUrl: vi.fn(async () => "https://blob.test/download"),
} as unknown as StorageService;

export const noopAudit: AuditLogger = { log: async () => {} };
export function realAudit(tx: TransactionClient, caller: CallerIdentity): AuditLogger {
  return { log: async (params) => createAuditEntry(tx, caller, params) };
}

export const run = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

/** CHF→SEK of the fixture (EUR/CHF = 1 so EUR/SEK is the CHF rate); 03-14/15 fall back to 03-13 (weekend). */
export async function seedRates(adminPool: Pool): Promise<void> {
  const rates: Record<string, number> = { ...FIXTURE.rates_fixture, "2026-04-01": 10.7647 };
  delete rates._note;
  for (const [date, rate] of Object.entries(rates)) {
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) SELECT $1::date, 'EUR/SEK', $2
       WHERE NOT EXISTS (SELECT 1 FROM ecb_rates WHERE date = $1::date AND currency_pair = 'EUR/SEK')`,
      [date, rate],
    );
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) SELECT $1::date, 'EUR/CHF', 1
       WHERE NOT EXISTS (SELECT 1 FROM ecb_rates WHERE date = $1::date AND currency_pair = 'EUR/CHF')`,
      [date],
    );
  }
}

export type Owner = {
  caller: CallerIdentity;
  accounts: { sek: string; chf: string; sav: string };
  /** the payers (F114): the two main accounts and the owner's two private instruments, as `PayerAccount`s */
  sources: {
    afSek: banking.PayerAccount;
    afChf: banking.PayerAccount;
    privateSe: banking.PayerAccount;
    privateCh: banking.PayerAccount;
  };
};

/** An owner with the three accounts, `Tr` (580) and `Rep` (583) aliases and the four payers. */
export async function setupOwner(adminPool: Pool, nordeaFormatId: string): Promise<Owner> {
  const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
  const accounts = await run(caller, async (tx) => {
    const sek = await banking.createBankAccount(tx, caller, noopAudit, {
      accountAlias: "Plusgirokonto SEK",
      accountNumber: "123 45 67-8",
      currency: "SEK",
      bankFormatId: nordeaFormatId,
    });
    const chf = await banking.createBankAccount(tx, caller, noopAudit, {
      accountAlias: "Plusgirokonto CHF",
      accountNumber: "123 45 67-8",
      currency: "CHF",
      bankFormatId: nordeaFormatId,
    });
    const sav = await banking.createBankAccount(tx, caller, noopAudit, {
      accountAlias: "Sparkonto",
      accountNumber: "1234 56 78901",
      currency: "SEK",
      bankFormatId: nordeaFormatId,
      role: "savings",
    });
    await settings.activateBasCategories(tx, caller, noopAudit, ["580", "583", "657"]);
    await settings.updateBasPreference(tx, caller, noopAudit, "580", { shortCode: "Tr" });
    await settings.updateBasPreference(tx, caller, noopAudit, "583", { shortCode: "Rep" });
    return { sek: sek.data!.id, chf: chf.data!.id, sav: sav.data!.id };
  });
  // the owner's group numbers start where the Excel left off
  await adminPool.query(
    `INSERT INTO number_series (tenant_id, series, next_value) VALUES ($1, 'expense_group', 213)`,
    [caller.tenantId],
  );
  const list = await run(caller, async (tx) => {
    for (const p of [
      { alias: "Private SE", currency: "SEK" as const },
      { alias: "Private CH", currency: "CHF" as const },
    ]) {
      const r = await banking.createPrivateAccount(tx, caller, noopAudit, p);
      if (r.error) throw new Error(r.error.message);
    }
    return banking.payerAccounts(tx);
  });
  const byLabel = (label: string) => {
    const s = list.find((x) => x.label === label);
    if (!s) throw new Error(`no payer ${label}`);
    return s;
  };
  return {
    caller,
    accounts,
    sources: {
      afSek: byLabel("Plusgirokonto SEK"),
      afChf: byLabel("Plusgirokonto CHF"),
      privateSe: byLabel("Private SE"),
      privateCh: byLabel("Private CH"),
    },
  };
}

export type CsvRow = {
  date: string;
  amount: string;
  name?: string;
  details?: string;
  message?: string;
};

/** A Nordea export of `rows` on `accountId` (dates ISO → `YYYY/MM/DD`, amounts with a decimal comma). */
export async function importRows(
  tx: TransactionClient,
  caller: CallerIdentity,
  accountId: string,
  currency: string,
  rows: CsvRow[],
): Promise<string[]> {
  const header =
    "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";
  const lines = rows.map(
    (r) =>
      `${r.date.replace(/-/g, "/")};${r.amount.replace(".", ",")};;;${r.name ?? ""};${r.details ?? ""};${r.message ?? ""};;;${currency};`,
  );
  const bytes = Buffer.from(`${header}\n${lines.join("\n")}\n`, "latin1");
  const fileName = `PLUSGIROKONTO FTG 123 45 67-8 - ${randomUUID().slice(0, 8)}.csv`;
  const r = await banking.importCsv(tx, caller, realAudit(tx, caller), storage, {
    bankAccountId: accountId,
    fileName,
    bytes,
  });
  if (r.error) throw new Error(`import failed: ${r.error.message}`);
  return r.data.transactionIds;
}
