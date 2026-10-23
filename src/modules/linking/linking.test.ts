import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestDocument,
  createTestPartner,
} from "@/kernel/db/test-fixtures";
import { contractLinkable } from "@/modules/contracts";
import * as documentService from "@/modules/documents";
import { documentLinkable } from "@/modules/documents";
import { _resetLinkables, type Linkable, registerLinkable } from "@/modules/linking";
import { partnerLinkable } from "@/modules/partners";
import * as linking from "./linking";
import { allocatedFrom, createdFromTargets, linksTouching } from "./queries";

const noopAudit: AuditLogger = { log: async () => {} };

function realAudit(tx: TransactionClient, caller: CallerIdentity): AuditLogger {
  return { log: async (params) => createAuditEntry(tx, caller, params) };
}

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

let adminPool: Pool;

/**
 * A fake linkable with an amount, so allocation rules can be tested before invoices/transactions exist.
 * Registered under the real "invoice" type; the kind matrix already accepts bank_transaction → invoice.
 */
const fakeInvoices = new Map<string, { label: string; amount: string; currency: string }>();
const fakeInvoiceLinkable: Linkable = {
  type: "invoice",
  async exists(_tx, id) {
    return fakeInvoices.has(id);
  },
  async summary(_tx, id) {
    const inv = fakeInvoices.get(id);
    return inv
      ? { type: "invoice", id, label: inv.label, amount: inv.amount, currency: inv.currency }
      : null;
  },
};
const fakeTransactions = new Set<string>();
const fakeTransactionLinkable: Linkable = {
  type: "bank_transaction",
  async exists(_tx, id) {
    return fakeTransactions.has(id);
  },
  async summary(_tx, id) {
    return fakeTransactions.has(id)
      ? {
          type: "bank_transaction",
          id,
          label: `tx ${id.slice(0, 8)}`,
          amount: null,
          currency: null,
        }
      : null;
  },
};

/** A fake expense (no amount needed here) — stands in for the expenses module in created_from tests. */
const fakeExpenses = new Set<string>();
const fakeExpenseLinkable: Linkable = {
  type: "expense",
  async exists(_tx, id) {
    return fakeExpenses.has(id);
  },
  async summary(_tx, id) {
    return fakeExpenses.has(id)
      ? { type: "expense", id, label: `expense ${id.slice(0, 8)}`, amount: null, currency: null }
      : null;
  },
};

const uuid = () => crypto.randomUUID();

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
  _resetLinkables();
  for (const l of [
    partnerLinkable,
    contractLinkable,
    documentLinkable,
    fakeInvoiceLinkable,
    fakeTransactionLinkable,
    fakeExpenseLinkable,
  ]) {
    registerLinkable(l);
  }
  fakeInvoices.clear();
  fakeTransactions.clear();
  fakeExpenses.clear();
});

afterAll(async () => {
  await adminPool.end();
});

describe("linking service", () => {
  it("links a document to a partner (belongs_to) and reads it back from both ends, audited", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const { tenantId, userId } = owner.callerIdentity;
    const partner = await createTestPartner(adminPool, tenantId, userId);
    const doc = await createTestDocument(adminPool, tenantId, userId);

    const created = await withTenantTransaction(prisma, tenantId, (tx) =>
      linking.createLink(tx, owner.callerIdentity, realAudit(tx, owner.callerIdentity), {
        from: { type: "document", id: doc.id },
        to: { type: "partner", id: partner.id },
        kind: "belongs_to",
        note: "NDA",
      }),
    );
    expect(created.error).toBeUndefined();
    expect(created.data?.kind).toBe("belongs_to");
    expect(created.data?.allocatedAmount).toBeNull();

    const [fromDoc, fromPartner, linked] = await withTenantTransaction(prisma, tenantId, (tx) =>
      Promise.all([
        linking.getLinksFor(tx, { type: "document", id: doc.id }),
        linking.getLinksFor(tx, { type: "partner", id: partner.id }),
        linking.isLinked(tx, { type: "document", id: doc.id }),
      ]),
    );
    expect(fromDoc.data).toHaveLength(1);
    expect(fromPartner.data?.[0].id).toBe(created.data?.id);
    expect(linked).toBe(true);

    const audit = await adminPool.query(
      "SELECT action, entity_type FROM audit_logs WHERE tenant_id = $1 AND entity_type = 'link'",
      [tenantId],
    );
    expect(audit.rows).toEqual([{ action: "create", entity_type: "link" }]);
  });

  it("rejects a duplicate link, a kind the pair does not accept, self-links and unknown endpoints", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const { tenantId, userId } = owner.callerIdentity;
    const partner = await createTestPartner(adminPool, tenantId, userId);
    const doc = await createTestDocument(adminPool, tenantId, userId);
    const input = {
      from: { type: "document" as const, id: doc.id },
      to: { type: "partner" as const, id: partner.id },
      kind: "belongs_to" as const,
    };

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      expect(
        (await linking.createLink(tx, owner.callerIdentity, noopAudit, input)).error,
      ).toBeUndefined();
      expect(
        (await linking.createLink(tx, owner.callerIdentity, noopAudit, input)).error?.code,
      ).toBe("DUPLICATE_ENTRY");
      expect(
        (
          await linking.createLink(tx, owner.callerIdentity, noopAudit, {
            ...input,
            kind: "transfer",
          })
        ).error?.code,
      ).toBe("BUSINESS_RULE_VIOLATION");
      expect(
        (
          await linking.createLink(tx, owner.callerIdentity, noopAudit, {
            ...input,
            to: input.from,
          })
        ).error?.code,
      ).toBe("BUSINESS_RULE_VIOLATION");
      expect(
        (
          await linking.createLink(tx, owner.callerIdentity, noopAudit, {
            ...input,
            to: { type: "partner", id: uuid() },
          })
        ).error?.code,
      ).toBe("NOT_FOUND");
    });
  });

  it("created_from (D27): a document becomes exactly one entity and an entity has one origin", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const { tenantId, userId } = owner.callerIdentity;
    const doc1 = await createTestDocument(adminPool, tenantId, userId);
    const doc2 = await createTestDocument(adminPool, tenantId, userId);
    const e1 = uuid();
    const e2 = uuid();
    fakeExpenses.add(e1).add(e2);
    const link = (expenseId: string, documentId: string) => ({
      from: { type: "expense" as const, id: expenseId },
      to: { type: "document" as const, id: documentId },
      kind: "created_from" as const,
    });

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const caller = owner.callerIdentity;
      expect(
        (await linking.createLink(tx, caller, noopAudit, link(e1, doc1.id))).error,
      ).toBeUndefined();

      // the same document cannot become a second entity
      const second = await linking.createLink(tx, caller, noopAudit, link(e2, doc1.id));
      expect(second.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(second.error?.message).toMatch(/already became/);

      // the same entity cannot have a second origin
      const secondOrigin = await linking.createLink(tx, caller, noopAudit, link(e1, doc2.id));
      expect(secondOrigin.error?.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(secondOrigin.error?.message).toMatch(/already created from/);

      // another pair is fine; the direction is fixed (entity → document); no allocation on this kind
      expect(
        (await linking.createLink(tx, caller, noopAudit, link(e2, doc2.id))).error,
      ).toBeUndefined();
      expect(
        (
          await linking.createLink(tx, caller, noopAudit, {
            from: { type: "document", id: doc1.id },
            to: { type: "expense", id: e2 },
            kind: "created_from",
          })
        ).error?.code,
      ).toBe("BUSINESS_RULE_VIOLATION");
      expect(
        (
          await linking.createLink(tx, caller, noopAudit, {
            ...link(e2, doc1.id),
            allocatedAmount: "10.00",
          })
        ).error?.code,
      ).toBe("BUSINESS_RULE_VIOLATION");

      const fromDoc = await linking.getLinksFor(tx, { type: "document", id: doc1.id });
      expect(fromDoc.data?.map((l) => [l.kind, l.from.id])).toEqual([["created_from", e1]]);
    });

    // the partial unique index holds even when the service is bypassed
    await expect(
      adminPool.query(
        `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
         VALUES ($1, 'supplier_invoice', $2, 'document', $3, 'created_from', $4)`,
        [tenantId, uuid(), doc1.id, userId],
      ),
    ).rejects.toThrow(/links_created_from_origin_key/);
  });

  it("createdFromTargets: per document the entity created from it, labels only on demand; other kinds and documents ignored", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const { tenantId, userId } = owner.callerIdentity;
    const became = await createTestDocument(adminPool, tenantId, userId);
    const justified = await createTestDocument(adminPool, tenantId, userId);
    const untouched = await createTestDocument(adminPool, tenantId, userId);
    const expenseId = uuid();
    fakeExpenses.add(expenseId);
    await adminPool.query(
      `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
       VALUES ($1, 'expense', $2, 'document', $3, 'created_from', $5),
              ($1, 'bank_transaction', gen_random_uuid(), 'document', $4, 'justifies', $5)`,
      [tenantId, expenseId, became.id, justified.id, userId],
    );

    const [plain, labelled, none] = await withTenantTransaction(prisma, tenantId, async (tx) => [
      await createdFromTargets(tx, [became.id, justified.id, untouched.id]),
      await createdFromTargets(tx, [became.id], { labels: true }),
      await createdFromTargets(tx, []),
    ]);
    expect([...plain.entries()]).toEqual([
      [became.id, { type: "expense", id: expenseId, label: null, key: null }],
    ]);
    expect(labelled.get(became.id)?.label).toBe(`expense ${expenseId.slice(0, 8)}`);
    expect(labelled.get(became.id)?.key).toBe(`expense ${expenseId.slice(0, 8)}`);
    expect(none.size).toBe(0);
  });

  it("allocations never exceed the target amount; remaining is reported", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const { tenantId } = owner.callerIdentity;
    const invoiceId = uuid();
    fakeInvoices.set(invoiceId, { label: "VA26-INV-001", amount: "1000.00", currency: "CHF" });
    const tx1 = uuid();
    const tx2 = uuid();
    const tx3 = uuid();
    for (const t of [tx1, tx2, tx3]) fakeTransactions.add(t);

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const to = { type: "invoice" as const, id: invoiceId };
      const first = await linking.createLink(tx, owner.callerIdentity, noopAudit, {
        from: { type: "bank_transaction", id: tx1 },
        to,
        kind: "justifies",
        allocatedAmount: "600.00",
      });
      expect(first.error).toBeUndefined();
      expect(first.data?.currency).toBe("CHF");

      const status1 = await linking.getAllocationStatus(tx, to);
      expect(status1.data).toMatchObject({
        amount: "1000.00",
        allocated: "600.00",
        remaining: "400.00",
      });

      const tooMuch = await linking.createLink(tx, owner.callerIdentity, noopAudit, {
        from: { type: "bank_transaction", id: tx2 },
        to,
        kind: "justifies",
        allocatedAmount: "400.01",
      });
      expect(tooMuch.error?.code).toBe("BUSINESS_RULE_VIOLATION");

      const wrongCurrency = await linking.createLink(tx, owner.callerIdentity, noopAudit, {
        from: { type: "bank_transaction", id: tx2 },
        to,
        kind: "justifies",
        allocatedAmount: "100.00",
        currency: "SEK",
      });
      expect(wrongCurrency.error?.code).toBe("BUSINESS_RULE_VIOLATION");

      const exact = await linking.createLink(tx, owner.callerIdentity, noopAudit, {
        from: { type: "bank_transaction", id: tx3 },
        to,
        kind: "justifies",
        allocatedAmount: "400.00",
      });
      expect(exact.error).toBeUndefined();
      const status2 = await linking.getAllocationStatus(tx, to);
      expect(status2.data?.remaining).toBe("0.00");

      // an allocation on a kind that does not allocate is refused
      const partnerLike = await linking.createLink(tx, owner.callerIdentity, noopAudit, {
        from: { type: "bank_transaction", id: tx1 },
        to: { type: "bank_transaction", id: tx2 },
        kind: "transfer",
        allocatedAmount: "1.00",
      });
      expect(partnerLike.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    });
  });

  it("allocatedFrom: Σ of the allocations from each source, allocating kinds only; linksTouching narrowed by kind", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const [a, b, idle] = [uuid(), uuid(), uuid()];
    for (const id of [a, b, idle]) fakeTransactions.add(id);
    const [inv1, inv2] = [uuid(), uuid()];
    fakeInvoices.set(inv1, { label: "VA26-INV-001", amount: "1000.00", currency: "CHF" });
    fakeInvoices.set(inv2, { label: "VA26-INV-002", amount: "1000.00", currency: "CHF" });
    await withTenantTransaction(prisma, caller.tenantId, async (tx) => {
      const link = (from: string, to: string, allocatedAmount?: string) =>
        linking.createLink(tx, caller, noopAudit, {
          from: { type: "bank_transaction", id: from },
          to: { type: "invoice", id: to },
          kind: "justifies",
          ...(allocatedAmount ? { allocatedAmount, currency: "CHF" } : {}),
        });
      expect((await link(a, inv1, "250.50")).error).toBeUndefined();
      expect((await link(a, inv2, "100.25")).error).toBeUndefined();
      expect((await link(b, inv1)).error).toBeUndefined(); // no allocation: not counted
      // a transfer carries no allocation and is not an allocating kind
      expect(
        (
          await linking.createLink(tx, caller, noopAudit, {
            from: { type: "bank_transaction", id: b },
            to: { type: "bank_transaction", id: idle },
            kind: "transfer",
          })
        ).error,
      ).toBeUndefined();
      const sums = await allocatedFrom(tx, "bank_transaction", [a, b, idle]);
      expect(Object.fromEntries(sums)).toEqual({ [a]: "350.75" });
      // linksTouching narrowed by kind
      const transfers = await linksTouching(tx, "bank_transaction", [a, b], {
        kinds: ["transfer"],
      });
      expect(transfers.map((l) => [l.kind, l.from.id, l.to.id])).toEqual([["transfer", b, idle]]);
      expect(await linksTouching(tx, "bank_transaction", [a, b])).toHaveLength(4);
      expect((await allocatedFrom(tx, "journal_entry", [a])).size).toBe(0); // the type is part of the key
      expect((await allocatedFrom(tx, "bank_transaction", [])).size).toBe(0);
    });
  });

  it("removeLink frees the allocation and is audited", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const { tenantId } = owner.callerIdentity;
    const invoiceId = uuid();
    fakeInvoices.set(invoiceId, { label: "VA26-INV-002", amount: "100.00", currency: "CHF" });
    const t = uuid();
    fakeTransactions.add(t);

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const audit = realAudit(tx, owner.callerIdentity);
      const link = await linking.createLink(tx, owner.callerIdentity, audit, {
        from: { type: "bank_transaction", id: t },
        to: { type: "invoice", id: invoiceId },
        kind: "justifies",
        allocatedAmount: "100.00",
      });
      const removed = await linking.removeLink(
        tx,
        owner.callerIdentity,
        audit,
        link.data?.id ?? "",
      );
      expect(removed.data?.removed).toBe(true);
      const status = await linking.getAllocationStatus(tx, { type: "invoice", id: invoiceId });
      expect(status.data?.remaining).toBe("100.00");
      const again = await linking.removeLink(tx, owner.callerIdentity, audit, link.data?.id ?? "");
      expect(again.error?.code).toBe("NOT_FOUND");
    });

    const audit = await adminPool.query(
      "SELECT action FROM audit_logs WHERE tenant_id = $1 AND entity_type = 'link' ORDER BY created_at",
      [tenantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["create", "delete"]);
  });

  it("a linked document cannot be hard-deleted (database trigger), unlinked it can", async () => {
    const owner = await createAuthenticatedContext(auth, "owner");
    const { tenantId, userId } = owner.callerIdentity;
    const partner = await createTestPartner(adminPool, tenantId, userId);
    const doc = await createTestDocument(adminPool, tenantId, userId);

    await withTenantTransaction(prisma, tenantId, async (tx) => {
      await linking.createLink(tx, owner.callerIdentity, noopAudit, {
        from: { type: "document", id: doc.id },
        to: { type: "partner", id: partner.id },
        kind: "belongs_to",
      });
    });

    // raw delete is refused by the trigger
    await expect(
      withTenantTransaction(prisma, tenantId, (tx) =>
        tx.document.delete({ where: { id: doc.id } }),
      ),
    ).rejects.toThrow(/document_linked/);

    // the service translates it into a business-rule error
    const blocked = await withTenantTransaction(prisma, tenantId, (tx) =>
      documentService.deleteDocument(tx, owner.callerIdentity, noopAudit, doc.id),
    );
    expect(blocked.error?.code).toBe("BUSINESS_RULE_VIOLATION");

    // unlink, then delete succeeds
    await withTenantTransaction(prisma, tenantId, async (tx) => {
      const links = await linking.getLinksFor(tx, { type: "document", id: doc.id });
      for (const l of links.data ?? [])
        await linking.removeLink(tx, owner.callerIdentity, noopAudit, l.id);
      await tx.document.delete({ where: { id: doc.id } });
    });
    const left = await adminPool.query("SELECT 1 FROM documents WHERE id = $1", [doc.id]);
    expect(left.rowCount).toBe(0);
  });

  it("RLS: a link is invisible from another tenant and cannot target another tenant's entity", async () => {
    const ownerA = await createAuthenticatedContext(auth, "owner");
    const ownerB = await createAuthenticatedContext(auth, "owner");
    const a = ownerA.callerIdentity;
    const b = ownerB.callerIdentity;
    const partnerA = await createTestPartner(adminPool, a.tenantId, a.userId);
    const docA = await createTestDocument(adminPool, a.tenantId, a.userId);

    await withTenantTransaction(prisma, a.tenantId, async (tx) => {
      expect(
        (
          await linking.createLink(tx, a, noopAudit, {
            from: { type: "document", id: docA.id },
            to: { type: "partner", id: partnerA.id },
            kind: "belongs_to",
          })
        ).error,
      ).toBeUndefined();
    });

    await withTenantTransaction(prisma, b.tenantId, async (tx) => {
      const seen = await linking.getLinksFor(tx, { type: "document", id: docA.id });
      expect(seen.data).toHaveLength(0);
      const cross = await linking.createLink(tx, b, noopAudit, {
        from: { type: "document", id: docA.id },
        to: { type: "partner", id: partnerA.id },
        kind: "belongs_to",
      });
      expect(cross.error?.code).toBe("NOT_FOUND");
    });
  });
});
