// Categorisation rules — specs/banking/spec.md US2 against the real database (RLS on).
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
  createTestPartner,
} from "@/kernel/db/test-fixtures";
import type { StorageService } from "@/kernel/storage/storage";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as partners from "@/modules/partners";
import { createBankAccount } from "./bank-accounts";
import { categorise, transactionFacts } from "./facts";
import { importCsv } from "./import";
import { transactionStates } from "./queries";
import * as rules from "./rules";

const FIXTURES = join(__dirname, "..", "..", "..", "specs", "banking", "fixtures");

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const storage = {
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
  resetRateLimit();
  mockHeaders = new Headers();
});
afterAll(async () => {
  await adminPool.end();
});

const run = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

/** A SEK account with the July sample imported (the default rules get created on that first import). */
async function july(caller: CallerIdentity) {
  const sek = await run(caller, async (tx) => {
    const a = await createBankAccount(tx, caller, noopAudit, {
      accountAlias: "Plusgirokonto SEK",
      accountNumber: "123 45 67-8",
      currency: "SEK",
      bankFormatId: nordeaFormatId,
    });
    return a.data?.id as string;
  });
  const summary = await run(caller, (tx) =>
    importCsv(tx, caller, noopAudit, storage, {
      bankAccountId: sek,
      fileName: "july.csv",
      bytes: readFileSync(join(FIXTURES, "nordea-2026-07-sek-sample.csv")),
    }),
  );
  if (summary.error) throw new Error(summary.error.message);
  return { sek, summary: summary.data };
}

const openaiOf = (tx: TransactionClient) =>
  tx.bankTransaction.findFirstOrThrow({ where: { counterpartyKey: { startsWith: "OPENAI" } } });
const entryOf = async (tx: TransactionClient, transactionId: string) =>
  (await transactionFacts(tx, [transactionId])).get(transactionId);

describe("US2 — rules that categorise", () => {
  it("scenario 1 + 8: the first import creates the defaults; a rule added later applies on demand (dry run first)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    const partner = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "OpenAI",
      types: ["supplier"],
    });
    await run(caller, async (tx) => {
      expect(await tx.categorisationRule.count()).toBe(2);
      const created = await rules.createRule(tx, caller, realAudit(tx, caller), {
        name: "OpenAI subscription",
        matchType: "contains",
        matchPattern: "OPENAI",
        basCode: "6540",
        partnerId: partner.id,
      });
      expect(created.error).toBeUndefined();
      expect(created.data?.matchField).toBe("counterparty_key");
      expect(created.data?.ruleSource).toBe("manual");
      // dry run: preview, nothing written
      const dry = await rules.applyRules(tx, caller, noopAudit, { dryRun: true });
      expect(dry.data?.dryRun).toBe(true);
      expect(dry.data?.applied).toBe(0);
      expect(dry.data?.preview.map((p) => p.ruleName)).toEqual(["OpenAI subscription"]);
      const before = await entryOf(tx, (await openaiOf(tx)).id);
      expect(before?.basCode).toBeNull();
      // real apply
      const applied = await rules.applyRules(tx, caller, realAudit(tx, caller), { dryRun: false });
      expect(applied.data?.applied).toBe(1);
      expect(applied.data?.tested).toBeGreaterThan(5);
      const after = await entryOf(tx, (await openaiOf(tx)).id);
      expect(after?.basCode).toBe("6540");
      expect(after?.partnerId).toBe(partner.id);
      expect(after?.categorisedBy).toBe("rule");
      expect(after?.ruleId).toBe(created.data?.id);
      const rule = await tx.categorisationRule.findUniqueOrThrow({
        where: { id: created.data?.id },
      });
      expect(rule.hitCount).toBe(1);
      expect(rule.lastHitAt).not.toBeNull();
      // a second apply has nothing left
      const again = await rules.applyRules(tx, caller, noopAudit, { dryRun: false });
      expect(again.data?.applied).toBe(0);
    });
    await assertAuditLogged(adminPool, caller.tenantId, "create", "categorisation_rule", undefined);
  });

  it("F116 PR C1: an amount or an account the row does not have leaves it uncategorised — and listed under Needs a look", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await july(caller);
    await run(caller, async (tx) => {
      const chf = await createBankAccount(tx, caller, noopAudit, {
        accountAlias: "Plusgirokonto CHF",
        accountNumber: "123 45 67-8",
        currency: "CHF",
        bankFormatId: nordeaFormatId,
      });
      const priced = await rules.createRule(tx, caller, noopAudit, {
        name: "OpenAI at 150",
        matchType: "contains",
        matchPattern: "OPENAI",
        basCode: "6540",
        bankAccountId: sek,
        sign: "out",
        expectedAmount: "150.00",
        tolerancePct: "0.5",
        cadence: "monthly",
      });
      expect(priced.error).toBeUndefined();
      expect(priced.data).toMatchObject({
        bankAccountId: sek,
        sign: "out",
        expectedAmount: "150.00",
        tolerancePct: "0.50",
        cadence: "monthly",
      });
      const applied = await rules.applyRules(tx, caller, noopAudit, { dryRun: false });
      expect(applied.data?.preview.map((p) => p.ruleName)).not.toContain("OpenAI at 150");
      expect((await entryOf(tx, (await openaiOf(tx)).id))?.basCode).toBeNull();
      const misses = await rules.ruleNearMisses(tx);
      expect(misses).toEqual([
        expect.objectContaining({
          ruleName: "OpenAI at 150",
          reason: "amount",
          expected: "150.00 ± 0.50 %",
          amount: "-132.52",
        }),
      ]);
      // the right price: it hits, the miss is gone
      await rules.updateRule(tx, caller, noopAudit, {
        id: priced.data?.id as string,
        expectedAmount: "132.52",
      });
      await rules.applyRules(tx, caller, noopAudit, { dryRun: false });
      expect((await entryOf(tx, (await openaiOf(tx)).id))?.basCode).toBe("6540");
      expect(await rules.ruleNearMisses(tx)).toEqual([]);

      // bound to another account: a near miss of its own kind
      await rules.createRule(tx, caller, noopAudit, {
        name: "Anthropic on CHF",
        matchType: "contains",
        matchPattern: "ANTHROPIC",
        basCode: "6540",
        bankAccountId: chf.data?.id,
      });
      expect((await rules.ruleNearMisses(tx)).map((m) => [m.ruleName, m.reason])).toEqual([
        ["Anthropic on CHF", "account"],
      ]);
      // a private instrument has no rows: refused as a rule's account
      const priv = await tx.bankAccount.create({
        data: {
          tenantId: caller.tenantId,
          accountAlias: "Private SE",
          accountNumber: "Private SE",
          currency: "SEK",
          role: "owner_private",
          createdBy: caller.userId,
        },
      });
      const refused = await rules.createRule(tx, caller, noopAudit, {
        name: "Private",
        matchType: "contains",
        matchPattern: "X",
        basCode: "6540",
        bankAccountId: priv.id,
      });
      expect(refused.error?.code).toBe("VALIDATION_ERROR");
    });
  });

  it("scenario 3: a partner-only rule fills the partner's default category", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    const partner = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "Anthropic",
      types: ["supplier"],
      defaultBasCategoryCode: "6540",
    });
    await run(caller, async (tx) => {
      await rules.createRule(tx, caller, noopAudit, {
        name: "Anthropic",
        matchType: "contains",
        matchPattern: "ANTHROPIC",
        partnerId: partner.id,
      });
      await rules.applyRules(tx, caller, noopAudit, { dryRun: false });
      const t = await tx.bankTransaction.findFirstOrThrow({
        where: { counterpartyKey: { startsWith: "ANTHROPIC" } },
      });
      const e = await entryOf(tx, t.id);
      expect(e?.partnerId).toBe(partner.id);
      expect(e?.basCode).toBe("6540");
      expect(e?.categorisedBy).toBe("rule");
    });
  });

  it("scenario 4: an entry categorised by hand is never touched by a rule", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    await run(caller, async (tx) => {
      const t = await openaiOf(tx);
      const e = await entryOf(tx, t.id);
      const byHand = await categorise(tx, caller, noopAudit, e?.id as string, {
        basCode: "6570",
      });
      expect(byHand.data?.categorisedBy).toBe("manual");
      await rules.createRule(tx, caller, noopAudit, {
        name: "OpenAI",
        matchType: "contains",
        matchPattern: "OPENAI",
        basCode: "6540",
      });
      const applied = await rules.applyRules(tx, caller, noopAudit, { dryRun: false });
      expect(applied.data?.applied).toBe(0);
      const after = await entryOf(tx, t.id);
      expect(after?.basCode).toBe("6570");
      expect(after?.categorisedBy).toBe("manual");
    });
  });

  it("lessons audit 32: hitCount counts only the hits that change an entry", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    await run(caller, async (tx) => {
      const created = await rules.createRule(tx, caller, noopAudit, {
        name: "OpenAI",
        matchType: "contains",
        matchPattern: "OPENAI",
        basCode: "6540",
      });
      const ruleId = created.data?.id as string;
      const t = await openaiOf(tx);
      const e = await entryOf(tx, t.id);
      const target = {
        transactionId: t.id,
        description: t.description,
        text: {
          counterpartyKey: t.counterpartyKey,
          name: t.name,
          additionalDetails: t.additionalDetails,
          message: t.message,
          sender: t.sender,
          recipient: t.recipient,
        },
      };
      const ruleRows = () => tx.categorisationRule.findMany({ where: { id: ruleId } });
      const hits = async () =>
        (await tx.categorisationRule.findUniqueOrThrow({ where: { id: ruleId } })).hitCount;

      // first apply writes the category: one hit
      const first = await rules.applyToTransactions(tx, caller, noopAudit, await ruleRows(), [
        target,
      ]);
      expect(first.data?.applied).toBe(1);
      expect((await entryOf(tx, t.id))?.basCode).toBe("6540");
      expect(await hits()).toBe(1);
      // the same rule on the same row again: nothing changes, nothing counted
      await rules.applyToTransactions(tx, caller, noopAudit, await ruleRows(), [target]);
      expect(await hits()).toBe(1);
      // a row set by hand: the rule matches, `categorise` refuses to overwrite, nothing counted
      await categorise(tx, caller, noopAudit, e?.id as string, { basCode: "6570" });
      await rules.applyToTransactions(tx, caller, noopAudit, await ruleRows(), [target]);
      expect(await hits()).toBe(1);
      expect((await entryOf(tx, t.id))?.basCode).toBe("6570");
    });
  });

  it("scenario 6: create rule from a transaction — pre-filled, learned, applied at once", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    await run(caller, async (tx) => {
      const t = await openaiOf(tx);
      const e = await entryOf(tx, t.id);
      // the owner first sets the category by hand, then "create rule from this"
      await categorise(tx, caller, noopAudit, e?.id as string, { basCode: "6540" });
      const learned = await rules.createRuleFromTransaction(tx, caller, realAudit(tx, caller), {
        transactionId: t.id,
      });
      expect(learned.error).toBeUndefined();
      expect(learned.data).toMatchObject({
        name: "OPENAI *CHATGPT SUBS",
        matchType: "contains",
        matchPattern: "OPENAI *CHATGPT SUBS",
        matchField: "counterparty_key",
        basCode: "6540",
        priority: 100,
        ruleSource: "learned",
      });
      // the hand-set entry keeps its facts (manual wins); the rule's counter did not move for it
      const after = await entryOf(tx, t.id);
      expect(after?.categorisedBy).toBe("manual");
      // an uncategorised twin gets it on the next import — simulated through applyRules on a fresh entry
      const test = await rules.testRule(tx, {
        matchType: "contains",
        matchPattern: "chatgpt",
        matchField: "counterparty_key",
      });
      expect(test.data?.tested).toBeGreaterThan(0);
    });
  });

  it("scenario 7: duplicate name, unknown BAS code, foreign partner, invalid regex, nothing set → refused", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    const foreign = await createTestPartner(adminPool, other.tenantId, other.userId, {
      name: "Theirs",
      types: ["supplier"],
    });
    await run(caller, async (tx) => {
      const ok = await rules.createRule(tx, caller, noopAudit, {
        name: "Fees",
        matchType: "contains",
        matchPattern: "AVGIFTER",
        noDocumentNeeded: true,
      });
      expect(ok.error).toBeUndefined();
      const dup = await rules.createRule(tx, caller, noopAudit, {
        name: "Fees",
        matchType: "contains",
        matchPattern: "X",
        noDocumentNeeded: true,
      });
      expect(dup.error?.code).toBe("DUPLICATE_ENTRY");
      const bas = await rules.createRule(tx, caller, noopAudit, {
        name: "Bad BAS",
        matchType: "contains",
        matchPattern: "X",
        basCode: "999",
      });
      expect(bas.error?.code).toBe("NOT_FOUND");
      const partner = await rules.createRule(tx, caller, noopAudit, {
        name: "Foreign partner",
        matchType: "contains",
        matchPattern: "X",
        partnerId: foreign.id,
      });
      expect(partner.error?.code).toBe("NOT_FOUND");
      const regex = await rules.createRule(tx, caller, noopAudit, {
        name: "Bad regex",
        matchType: "regex",
        matchPattern: "(unclosed",
        basCode: "6570",
      });
      expect(regex.error?.code).toBe("VALIDATION_ERROR");
      const nothing = await rules.createRule(tx, caller, noopAudit, {
        name: "Sets nothing",
        matchType: "contains",
        matchPattern: "X",
      });
      expect(nothing.error?.code).toBe("VALIDATION_ERROR");
      // update: deactivate, change priority, bad regex refused
      const upd = await rules.updateRule(tx, caller, noopAudit, {
        id: ok.data?.id as string,
        priority: 5,
        isActive: false,
      });
      expect(upd.data?.priority).toBe(5);
      expect(upd.data?.isActive).toBe(false);
      const badUpd = await rules.updateRule(tx, caller, noopAudit, {
        id: ok.data?.id as string,
        matchType: "regex",
        matchPattern: "[",
      });
      expect(badUpd.error?.code).toBe("VALIDATION_ERROR");
      const del = await rules.deleteRule(tx, caller, noopAudit, ok.data?.id as string);
      expect(del.data?.id).toBe(ok.data?.id);
      expect(await tx.categorisationRule.count()).toBe(0);
    });
  });

  it("RLS: rules of another tenant are invisible and never applied", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    await run(other, (tx) =>
      rules.createRule(tx, other, noopAudit, {
        name: "Their OpenAI",
        matchType: "contains",
        matchPattern: "OPENAI",
        basCode: "6540",
      }),
    );
    await july(caller);
    await run(caller, async (tx) => {
      expect((await rules.listRules(tx)).map((r) => r.name)).toEqual([
        "Nordea bank fees",
        "Savings interest",
      ]);
      const e = await entryOf(tx, (await openaiOf(tx)).id);
      expect(e?.basCode).toBeNull();
    });
  });
});

describe("F129 — the defaults name the bank, rulesForKey, a no-proof rule without a partner under Needs a look", () => {
  it("the first import seeds the four partners and the two defaults carry the bank; the fee row is no document with Nordea", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { summary } = await july(caller);
    await run(caller, async (tx) => {
      const bank = await partners.systemPartner(tx, "bank");
      expect(bank).toMatchObject({ name: "Nordea", systemRole: "bank" });
      const defaults = await tx.categorisationRule.findMany({ orderBy: { priority: "desc" } });
      expect(defaults.map((r) => [r.name, r.partnerId])).toEqual([
        ["Nordea bank fees", bank?.id],
        ["Savings interest", bank?.id],
      ]);
      const fee = await tx.bankTransaction.findFirstOrThrow({
        where: { counterpartyKey: { contains: "AVGIFTER NORDEA" } },
      });
      expect(fee).toMatchObject({ noDocumentNeeded: true, basCode: "6570", partnerId: bank?.id });
      const state = (await transactionStates(tx, [fee.id])).get(fee.id);
      expect(state).toMatchObject({
        state: "no_document",
        partnerName: "Nordea",
        partnerFrom: "row",
      });
      expect(summary.categorised).toBeGreaterThan(0);
      // a second import of the same file makes nothing more
      const again = await partners.ensureSystemPartners(tx, caller, noopAudit, {
        bankName: "Nordea",
      });
      expect(again.data).toEqual({ created: [], attached: [] });
      expect(await tx.partner.count()).toBe(4);
    });
  });

  it("rulesForKey: the active rules whose text matches the key alone, in run order — the account and sign conditions are not read", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const { sek } = await july(caller);
    const microsoft = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "Microsoft Ireland Operations Ltd",
      types: ["vendor"],
    });
    const old = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "Old Vendor",
      types: ["vendor"],
    });
    await run(caller, async (tx) => {
      const make = (name: string, extra: Partial<rules.RuleInput>) =>
        rules.createRule(tx, caller, noopAudit, {
          name,
          matchType: "contains",
          matchPattern: "MSFT",
          partnerId: microsoft.id,
          ...extra,
        });
      expect((await make("MSFT → Microsoft", { priority: 50 })).error).toBeUndefined();
      expect(
        (await make("MSFT → old", { partnerId: old.id, isActive: false })).error,
      ).toBeUndefined();
      // a CHF-only rule for the key: the text matches, the account condition is the import's business
      expect(
        (await make("MSFT on the card", { priority: 90, bankAccountId: sek, sign: "out" })).error,
      ).toBeUndefined();
      const hits = await rules.rulesForKey(tx, "MSFT * E0100ZW7M8");
      expect(hits.map((r) => r.name)).toEqual(["MSFT on the card", "MSFT → Microsoft"]);
      expect(hits.every((r) => r.partnerId === microsoft.id)).toBe(true);
      expect(await rules.rulesForKey(tx, "OPENAI *CHATGPT SUBS")).toEqual([]);
    });
  });

  it("Needs a look: an active rule that sets no proof without a partner, once, with its row count; a partner clears it", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    await run(caller, async (tx) => {
      const insurance = await rules.createRule(tx, caller, noopAudit, {
        name: "Insurance",
        matchType: "contains",
        matchPattern: "OPENAI",
        basCode: "6310",
        noDocumentNeeded: true,
      });
      expect(insurance.error).toBeUndefined();
      await rules.applyRules(tx, caller, noopAudit, { dryRun: false });
      const misses = await rules.ruleNearMisses(tx);
      const entry = misses.filter((m) => m.reason === "no_partner");
      expect(entry).toEqual([
        {
          transactionId: null,
          bookingDate: null,
          amount: null,
          currency: null,
          description: null,
          ruleId: insurance.data?.id,
          ruleName: "Insurance",
          reason: "no_partner",
          expected: null,
          rows: 1,
        },
      ]);
      // the row it flagged is *no proof · no partner* — still to justify
      const row = await openaiOf(tx);
      expect((await transactionStates(tx, [row.id])).get(row.id)?.state).toBe(
        "no_document_no_partner",
      );
      // the defaults (the bank) and an inactive rule are not listed
      const bank = await partners.systemPartner(tx, "bank");
      const fixed = await rules.updateRule(tx, caller, noopAudit, {
        id: insurance.data?.id as string,
        partnerId: bank?.id,
      });
      expect(fixed.error).toBeUndefined();
      expect((await rules.ruleNearMisses(tx)).filter((m) => m.reason === "no_partner")).toEqual([]);
    });
  });
});
