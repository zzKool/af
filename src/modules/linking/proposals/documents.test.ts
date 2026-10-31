// F126 (specs/ai/spec-suggest-from-first-entry.md US2, FR-203 / FR-204): the model's BAS account for an inbox
// document — from the vendor's first document, not when the vendor's own default answers, not twice on the same
// facts; the dialog's save decides it; a delete drops it first; RLS and the composite FK hold. Invented data.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAiService } from "@/kernel/ai/ai";
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
import * as documents from "@/modules/documents";
import * as settings from "@/modules/settings";
import { currentDocumentProposals, decideDocumentProposal, documentBasHints } from "./documents";
import { proposeForDocuments } from "./jobs/propose";

vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
beforeAll(() => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
});
afterAll(async () => {
  await adminPool.end();
});

const run = <T>(c: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, c.tenantId, fn);
const auditFor = (tx: TransactionClient, c: CallerIdentity): AuditLogger => ({
  log: async (params) => createAuditEntry(tx, c, params),
});

const ANSWER = {
  basCode: "659",
  confidence: 0.88,
  reason: "A monthly software plan",
  alternatives: [{ basCode: "654", why: "IT services" }],
};
const mock = () => createMockAiService({ "linking.bas-proposal": ANSWER });

async function owner() {
  const { callerIdentity: c } = await createAuthenticatedContext(auth, "owner");
  await run(c, (tx) =>
    settings.activateBasCategories(tx, c, auditFor(tx, c), ["501", "654", "659"]),
  );
  return c;
}

/** an extracted receipt in the inbox, read by OCR (invented vendor) */
async function receipt(c: CallerIdentity, vendor = "Cloudnimbus Ltd") {
  return run(c, async (tx) => {
    const d = await tx.document.create({
      data: {
        tenantId: c.tenantId,
        businessKey: `Up26-10-${randomUUID().slice(0, 4)}`,
        fileName: "receipt.pdf",
        blobUrl: "https://blob.test/r",
        mimeType: "application/pdf",
        fileSize: 10,
        prefixType: "expense",
        documentType: "financial",
        status: "extracted",
        ocrData: {
          extractedData: {
            vendorName: vendor,
            invoiceTotal: 19,
            currency: "EUR",
            invoiceDate: "2026-10-02",
            items: [{ description: "Team plan, monthly" }],
            confidence: 0.9,
            modelUsed: "test",
            pageCount: 1,
            processingTimeMs: 1,
          },
        },
        createdBy: c.userId,
      },
    });
    return d.id;
  });
}

describe("proposals on documents (F126)", () => {
  it("US2: the first receipt of a vendor never seen is proposed — HIGH, a hint for the dialogs", async () => {
    const c = await owner();
    const id = await receipt(c);
    const prompts: string[] = [];
    const base = mock();
    const r = await proposeForDocuments(
      { tenantId: c.tenantId, userId: c.userId, documentIds: [id] },
      {
        kind: "mock",
        complete: async (call) => {
          prompts.push(call.messages[1]?.content ?? "");
          return base.complete(call);
        },
      },
    );
    expect(r).toEqual({ asked: 1, proposed: 1, failed: 0, stopped: false });
    expect(prompts[0]).toContain("From: Cloudnimbus Ltd");
    expect(prompts[0]).toContain("Lines: Team plan, monthly");
    expect(prompts[0]).toContain("Total: 19.00 EUR");
    const hints = await run(c, (tx) => documentBasHints(tx, [id]));
    expect(hints[id]).toEqual({ code: "659", reason: "A monthly software plan", prefill: true });
    // not asked again on the same facts
    const again = await proposeForDocuments(
      { tenantId: c.tenantId, userId: c.userId, all: true },
      mock(),
    );
    expect(again.asked).toBe(0);
  });

  it("the vendor's own default account answers: the model is not asked; AI off asks nothing", async () => {
    const c = await owner();
    await createTestPartner(adminPool, c.tenantId, c.userId, {
      name: "Cloudnimbus Ltd",
      types: ["vendor"],
      defaultBasCategoryCode: "654",
    });
    const id = await receipt(c);
    const scope = { tenantId: c.tenantId, userId: c.userId, documentIds: [id] };
    expect((await proposeForDocuments(scope, mock())).asked).toBe(0);
    const off = { kind: "off" as const, complete: vi.fn() };
    const other = await receipt(c, "Deskshare AB");
    expect((await proposeForDocuments({ ...scope, documentIds: [other] }, off)).asked).toBe(0);
    expect(off.complete).not.toHaveBeenCalled();
  });

  it("the dialog's save decides: the code kept → accepted, another → rejected; the hint is gone", async () => {
    const c = await owner();
    const kept = await receipt(c);
    const changed = await receipt(c, "Deskshare AB");
    await proposeForDocuments(
      { tenantId: c.tenantId, userId: c.userId, documentIds: [kept, changed] },
      mock(),
    );
    const decisions = await run(c, async (tx) => [
      await decideDocumentProposal(tx, c, auditFor(tx, c), kept, "659"),
      await decideDocumentProposal(tx, c, auditFor(tx, c), changed, "501"),
      await decideDocumentProposal(tx, c, auditFor(tx, c), changed, "501"),
    ]);
    expect(decisions).toEqual(["accepted", "rejected", null]);
    expect((await run(c, (tx) => currentDocumentProposals(tx, [kept, changed]))).size).toBe(0);
    const rejected = await proposeForDocuments(
      { tenantId: c.tenantId, userId: c.userId, documentIds: [changed] },
      mock(),
    );
    expect(rejected.asked).toBe(0); // a rejection stands while the facts are unchanged
  });

  it("deleting the document drops its proposals first; RLS hides them; the FK refuses another tenant's document", async () => {
    const a = await owner();
    const b = await owner();
    const id = await receipt(a);
    await proposeForDocuments(
      { tenantId: a.tenantId, userId: a.userId, documentIds: [id] },
      mock(),
    );
    expect(await run(b, (tx) => tx.proposal.count())).toBe(0);
    await expect(
      run(b, (tx) =>
        tx.proposal.create({
          data: {
            tenantId: b.tenantId,
            runId: randomUUID(),
            targetType: "document",
            targetId: id,
            documentId: id,
            kind: "bas",
            payload: { basCode: "654", alternatives: [] },
            source: "model",
            model: "mock",
            promptVersion: "bas-proposal.v1",
            confidence: "0.80",
            factsHash: "x",
            createdBy: b.userId,
          },
        }),
      ),
    ).rejects.toThrow();
    const del = await run(a, (tx) => documents.deleteDocument(tx, a, auditFor(tx, a), id));
    expect(del.error).toBeUndefined();
    expect(await run(a, (tx) => tx.proposal.count())).toBe(0);
  });

  it("the target column must match the target type (the CHECK)", async () => {
    const c = await owner();
    const id = await receipt(c);
    await expect(
      run(c, (tx) =>
        tx.proposal.create({
          data: {
            tenantId: c.tenantId,
            runId: randomUUID(),
            targetType: "document",
            targetId: id,
            kind: "bas",
            payload: { basCode: "654", alternatives: [] },
            source: "model",
            model: "mock",
            promptVersion: "bas-proposal.v1",
            confidence: "0.80",
            factsHash: "x",
            createdBy: c.userId,
          },
        }),
      ),
    ).rejects.toThrow(/proposals_target_column_check/);
  });
});
