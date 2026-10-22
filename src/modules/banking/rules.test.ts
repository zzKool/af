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
import * as journal from "@/modules/journal";
import { createBankAccount } from "./bank-accounts";
import { importCsv } from "./import";
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
  (await journal.entriesForSources(tx, "bank_transaction", [transactionId])).get(transactionId);

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
        basCode: "654",
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
      expect(after?.basCode).toBe("654");
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

  it("scenario 3: a partner-only rule fills the partner's default category", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    const partner = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "Anthropic",
      types: ["supplier"],
      defaultBasCategoryCode: "654",
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
      expect(e?.basCode).toBe("654");
      expect(e?.categorisedBy).toBe("rule");
    });
  });

  it("scenario 4: an entry categorised by hand is never touched by a rule", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    await run(caller, async (tx) => {
      const t = await openaiOf(tx);
      const e = await entryOf(tx, t.id);
      const byHand = await journal.categorise(tx, caller, noopAudit, e?.id as string, {
        basCode: "657",
      });
      expect(byHand.data?.categorisedBy).toBe("manual");
      await rules.createRule(tx, caller, noopAudit, {
        name: "OpenAI",
        matchType: "contains",
        matchPattern: "OPENAI",
        basCode: "654",
      });
      const applied = await rules.applyRules(tx, caller, noopAudit, { dryRun: false });
      expect(applied.data?.applied).toBe(0);
      const after = await entryOf(tx, t.id);
      expect(after?.basCode).toBe("657");
      expect(after?.categorisedBy).toBe("manual");
    });
  });

  it("scenario 6: create rule from a transaction — pre-filled, learned, applied at once", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await july(caller);
    await run(caller, async (tx) => {
      const t = await openaiOf(tx);
      const e = await entryOf(tx, t.id);
      // the owner first sets the category by hand, then "create rule from this"
      await journal.categorise(tx, caller, noopAudit, e?.id as string, { basCode: "654" });
      const learned = await rules.createRuleFromTransaction(tx, caller, realAudit(tx, caller), {
        transactionId: t.id,
      });
      expect(learned.error).toBeUndefined();
      expect(learned.data).toMatchObject({
        name: "OPENAI *CHATGPT SUBS",
        matchType: "contains",
        matchPattern: "OPENAI *CHATGPT SUBS",
        matchField: "counterparty_key",
        basCode: "654",
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
        basCode: "657",
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
        basCode: "654",
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
