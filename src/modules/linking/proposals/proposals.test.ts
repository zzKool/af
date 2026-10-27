// Proposals against the real database, RLS on (F98, specs/ai US1, US4; FR-003, FR-004, FR-007, FR-008) — on the
// invented fixture specs/ai/fixtures/nordea-ai-memory-sek.csv (three CLOUDHOST rows, one BYTEFORM row).
import { randomUUID } from "node:crypto";
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
import * as banking from "@/modules/banking";
import { proposeForRows } from "./jobs/propose";
import {
  acceptProposals,
  currentProposals,
  proposalStats,
  rejectProposal,
  runProposals,
} from "./proposals";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "specs",
  "ai",
  "fixtures",
  "nordea-ai-memory-sek.csv",
);

const storage: StorageService = {
  ensureContainer: vi.fn(async () => {}),
  uploadBlob: vi.fn(async (path: string) => `https://blob.test/documents/${path}`),
  downloadBlob: vi.fn(),
  deleteBlob: vi.fn(),
  generateSasUrl: vi.fn(),
  generateDownloadUrl: vi.fn(async () => "https://blob.test/download"),
} as unknown as StorageService;

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
  resetRateLimit();
  mockHeaders = new Headers();
});
afterAll(async () => {
  await adminPool.end();
});

const run = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

/** the fixture imported into a fresh SEK account; the rows by message */
async function imported(caller: CallerIdentity) {
  return run(caller, async (tx) => {
    const audit = auditFor(tx, caller);
    const acc = await banking.createBankAccount(tx, caller, audit, {
      accountAlias: "Plusgirokonto SEK",
      accountNumber: "123 45 67-8",
      currency: "SEK",
      bankFormatId: nordeaFormatId,
    });
    const r = await banking.importCsv(tx, caller, audit, storage, {
      bankAccountId: acc.data?.id as string,
      fileName: "nordea-ai-memory-sek.csv",
      bytes: readFileSync(FIXTURE),
    });
    expect(r.error).toBeUndefined();
    const rows = await tx.bankTransaction.findMany({ select: { id: true, message: true } });
    const by = (m: string) => rows.find((x) => x.message === m)?.id as string;
    return {
      importId: r.data?.id as string,
      inv1: by("CLOUDHOST INV 1"),
      inv2: by("CLOUDHOST INV 2"),
      inv3: by("CLOUDHOST INV 3"),
      byteform: by("BYTEFORM 2026-07"),
    };
  });
}

/** the owner categorises the two oldest CLOUDHOST rows by hand */
async function history(
  caller: CallerIdentity,
  ids: { inv1: string; inv2: string },
  partnerId: string,
) {
  await run(caller, async (tx) => {
    for (const id of [ids.inv1, ids.inv2]) {
      const r = await banking.categorise(tx, caller, auditFor(tx, caller), id, {
        basCode: "654",
        partnerId,
      });
      expect(r.error).toBeUndefined();
    }
  });
}

describe("F98 — stage-1 proposals", () => {
  it("US1: two rows set by hand → the third gets a HIGH category and partner, remembered, pre-filled", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "Cloudhost AB",
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);

    const result = await proposeForRows({
      tenantId: caller.tenantId,
      userId: caller.userId,
      all: true,
    });
    expect(result).toMatchObject({ rows: 2, proposed: 2 }); // inv3 (two kinds); BYTEFORM has no memory

    const current = await run(caller, (tx) => currentProposals(tx, [ids.inv3, ids.byteform]));
    expect(current.get(ids.byteform)).toBeUndefined();
    const list = current.get(ids.inv3) ?? [];
    expect(list.map((p) => [p.kind, p.source, p.family, p.prefilled])).toEqual([
      ["bas", "memory", "high", true],
      ["partner", "memory", "high", true],
    ]);
    expect(list[0]).toMatchObject({ payload: { basCode: "654" }, confidence: 0.8 });
    expect(list[1]).toMatchObject({ payload: { partnerId: cloud.id } });
  });

  it("a second run with nothing new writes nothing (no churn)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    await proposeForRows({ tenantId: caller.tenantId, userId: caller.userId, all: true });
    const again = await proposeForRows({
      tenantId: caller.tenantId,
      userId: caller.userId,
      all: true,
    });
    expect(again).toMatchObject({ proposed: 0, unchanged: 2 });
    expect(await run(caller, (tx) => tx.proposal.count())).toBe(2);
  });

  it("a rule made after the import proposes for the rows it never categorised", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    await run(caller, (tx) =>
      banking.createRule(tx, caller, auditFor(tx, caller), {
        name: "Byteform",
        matchType: "contains",
        matchPattern: "BYTEFORM",
        matchField: "counterparty_key",
        basCode: "659",
        isActive: true,
      }),
    );
    await proposeForRows({
      tenantId: caller.tenantId,
      userId: caller.userId,
      transactionIds: [ids.byteform],
    });
    const [p] =
      (await run(caller, (tx) => currentProposals(tx, [ids.byteform]))).get(ids.byteform) ?? [];
    expect(p).toMatchObject({
      kind: "bas",
      source: "rule",
      confidence: 1,
      reason: "Rule “Byteform”",
    });
  });

  it("accept: one categorise by hand + the decision + an audit row; the rule is offered; then nothing is current", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    await proposeForRows({ tenantId: caller.tenantId, userId: caller.userId, all: true });

    const r = await run(caller, (tx) =>
      acceptProposals(tx, caller, auditFor(tx, caller), { transactionId: ids.inv3 }),
    );
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({ proposeRule: true });
    expect(r.data?.transaction).toMatchObject({
      basCode: "654",
      partnerId: cloud.id,
      categorisedBy: "manual",
    });
    expect(r.data?.accepted).toHaveLength(2);

    const decided = await run(caller, (tx) =>
      tx.proposal.findMany({ where: { targetId: ids.inv3 } }),
    );
    expect(decided.every((p) => p.decision === "accepted" && p.decidedBy === caller.userId)).toBe(
      true,
    );
    const audits = await run(caller, (tx) =>
      tx.auditLog.count({ where: { entityType: "proposal" } }),
    );
    expect(audits).toBe(2);
    expect(
      (await run(caller, (tx) => currentProposals(tx, [ids.inv3]))).get(ids.inv3),
    ).toBeUndefined();
  });

  it("accept with an alternative's code writes that code", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    await proposeForRows({ tenantId: caller.tenantId, userId: caller.userId, all: true });
    const [bas] = (await run(caller, (tx) => currentProposals(tx, [ids.inv3]))).get(ids.inv3) ?? [];
    const r = await run(caller, (tx) =>
      acceptProposals(tx, caller, auditFor(tx, caller), {
        transactionId: ids.inv3,
        proposalIds: [bas.id],
        overrideBasCode: "659",
      }),
    );
    expect(r.data?.transaction.basCode).toBe("659");
    expect(r.data?.transaction.partnerId).toBeNull();
  });

  it("US4: reject → not current; the next run skips it while the facts are unchanged, proposes again once they change", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    await proposeForRows({ tenantId: caller.tenantId, userId: caller.userId, all: true });
    const [bas] = (await run(caller, (tx) => currentProposals(tx, [ids.inv3]))).get(ids.inv3) ?? [];

    const r = await run(caller, (tx) =>
      rejectProposal(tx, caller, auditFor(tx, caller), { proposalId: bas.id }),
    );
    expect(r.error).toBeUndefined();
    const left = (await run(caller, (tx) => currentProposals(tx, [ids.inv3]))).get(ids.inv3) ?? [];
    expect(left.map((p) => p.kind)).toEqual(["partner"]);

    const next = await proposeForRows({
      tenantId: caller.tenantId,
      userId: caller.userId,
      all: true,
    });
    expect(next).toMatchObject({ proposed: 0, skipped: 1, unchanged: 1 });

    // the row's facts change (a rule sets the partner) → the category is proposed again
    await run(caller, (tx) =>
      banking.categorise(
        tx,
        caller,
        auditFor(tx, caller),
        ids.inv3,
        { partnerId: cloud.id },
        { by: "rule" },
      ),
    );
    const after = await proposeForRows({
      tenantId: caller.tenantId,
      userId: caller.userId,
      all: true,
    });
    expect(after.proposed).toBe(1);
  });

  it("a stale proposal is refused (the row was categorised by hand meanwhile)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    await proposeForRows({ tenantId: caller.tenantId, userId: caller.userId, all: true });
    const [bas] = (await run(caller, (tx) => currentProposals(tx, [ids.inv3]))).get(ids.inv3) ?? [];
    await run(caller, (tx) =>
      banking.categorise(tx, caller, auditFor(tx, caller), ids.inv3, { basCode: "659" }),
    );
    const r = await run(caller, (tx) =>
      acceptProposals(tx, caller, auditFor(tx, caller), {
        transactionId: ids.inv3,
        proposalIds: [bas.id],
      }),
    );
    expect(r.error?.code).toBe("BUSINESS_RULE_VIOLATION");
  });

  it("deleting the import drops its rows' proposals (D63: no cascade, banking asks linking)", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    await proposeForRows({ tenantId: caller.tenantId, userId: caller.userId, all: true });
    expect(await run(caller, (tx) => tx.proposal.count())).toBe(2);
    const del = await run(caller, (tx) =>
      banking.deleteImport(tx, caller, auditFor(tx, caller), ids.importId),
    );
    expect(del.error).toBeUndefined();
    expect(await run(caller, (tx) => tx.proposal.count())).toBe(0);
  });

  it("the composite FK refuses a proposal on another tenant's row; RLS hides the rows", async () => {
    const { callerIdentity: a } = await createAuthenticatedContext(auth, "owner");
    const { callerIdentity: b } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(a);
    const cloud = await createTestPartner(adminPool, a.tenantId, a.userId, { types: ["vendor"] });
    await history(a, ids, cloud.id);
    await proposeForRows({ tenantId: a.tenantId, userId: a.userId, all: true });
    expect(await run(b, (tx) => tx.proposal.count())).toBe(0);
    expect((await run(b, (tx) => currentProposals(tx, [ids.inv3]))).size).toBe(0);
    await expect(
      run(b, (tx) =>
        tx.proposal.create({
          data: {
            tenantId: b.tenantId,
            runId: randomUUID(),
            targetType: "bank_transaction",
            targetId: ids.inv3,
            kind: "bas",
            payload: { basCode: "654", alternatives: [] },
            source: "memory",
            confidence: "0.80",
            factsHash: "x",
            createdBy: b.userId,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("the accountant cannot decide", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const caller = owner.callerIdentity;
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    await proposeForRows({ tenantId: caller.tenantId, userId: caller.userId, all: true });
    const accountant: CallerIdentity = { ...caller, role: "accountant" };
    const r = await run(accountant, (tx) =>
      acceptProposals(tx, accountant, auditFor(tx, accountant), { transactionId: ids.inv3 }),
    );
    expect(r.error?.code).toBe("FORBIDDEN");
  });

  it("stats count per source and decision; runProposals ignores a row categorised by hand", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = await imported(caller);
    const cloud = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      types: ["vendor"],
    });
    await history(caller, ids, cloud.id);
    const direct = await run(caller, (tx) =>
      runProposals(tx, caller, { runId: randomUUID(), transactionIds: [ids.inv1, ids.inv3] }),
    );
    expect(direct.rows).toBe(1); // inv1 is the owner's own
    await run(caller, (tx) =>
      acceptProposals(tx, caller, auditFor(tx, caller), { transactionId: ids.inv3 }),
    );
    const s = await run(caller, (tx) => proposalStats(tx, 30));
    expect(s.bySource).toEqual([{ source: "memory", made: 2, accepted: 2, rejected: 0 }]);
    expect(s.lastRunAt).not.toBeNull();
  });
});
