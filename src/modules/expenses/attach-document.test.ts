// F94 FR-012 (specs/subscriptions, PR2): the receipt after the expense — attach / detach a document in every state —
// and the delete rule widened to `occurrence_of` (an attribution to a subscription, not proof). Real database, RLS on.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData, createTestDocument } from "@/kernel/db/test-fixtures";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as documents from "@/modules/documents";
import * as linking from "@/modules/linking";
import {
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  seedRates,
  setupOwner,
} from "./__fixtures__/harness";
import {
  attachBankTransaction,
  attachDocument,
  createExpense,
  deleteExpense,
  detachDocument,
} from "./expenses";
import { createGroup } from "./groups";
import { getExpenseDetail } from "./queries";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  await seedRates(adminPool);
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

/** A SEK company-paid expense in a batch group (a subscription's kind of expense), with no document. */
async function sekExpense() {
  const g = await run(owner.caller, (tx) =>
    createGroup(tx, owner.caller, noopAudit, { description: "Byteform", kind: "batch" }),
  );
  const e = await run(owner.caller, (tx) =>
    createExpense(tx, owner.caller, noopAudit, {
      groupId: g.data!.id,
      date: "2026-03-16",
      description: "Byteform",
      basCode: "580",
      amount: "199.00",
      currency: "SEK",
      paymentSourceId: owner.sources.afSek.id,
      documentMissing: true,
    }),
  );
  expect(e.error).toBeUndefined();
  return e.data!;
}

const receipt = (n: string) =>
  createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
    businessKey: `exp_20260316_00${n}`,
    fileName: `exp_20260316_00${n}.pdf`,
    status: "extracted",
  });

const inboxState = (tx: Parameters<typeof documents.listInbox>[0], id: string) =>
  documents.listInbox(tx, owner.caller).then((l) => l.rows.find((r) => r.id === id)?.state ?? null);

describe("attachDocument — the receipt after the expense (FR-012)", () => {
  it("renames the receipt, links created_from, clears document missing; the receipt leaves the inbox", async () => {
    const e = await sekExpense();
    const doc = await receipt("1");
    const r = await run(owner.caller, (tx) =>
      attachDocument(tx, owner.caller, realAudit(tx, owner.caller), {
        expenseId: e.id,
        documentId: doc.id,
      }),
    );
    expect(r.error).toBeUndefined();
    expect(r.data?.documentMissing).toBe(false);
    await run(owner.caller, async (tx) => {
      const d = await tx.document.findUnique({ where: { id: doc.id } });
      expect(d?.businessKey).toBe(`${e.key}_2026-03-16_`);
      const detail = await getExpenseDetail(tx, e.id);
      expect(detail.data?.document?.id).toBe(doc.id);
      expect(detail.data?.links.map((l) => l.kind)).toEqual(["created_from"]);
      expect(await inboxState(tx, doc.id)).toBeNull();
    });
    await assertAuditLogged(adminPool, owner.caller.tenantId, "update", "expense", e.id);
  });

  it("is allowed on a paid (locked) expense and touches none of its money facts", async () => {
    const e = await sekExpense();
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-16", amount: "-199.00", name: "BYTEFORM AB" },
      ]),
    );
    const paid = await run(owner.caller, (tx) =>
      attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: e.id,
        bankTransactionId: rowId!,
      }),
    );
    expect(paid.error).toBeUndefined();
    const before = await adminPool.query(
      "SELECT amount, currency, date, amount_base, rate, rate_source, paid_amount FROM expenses WHERE id = $1",
      [e.id],
    );
    const doc = await receipt("1");
    const r = await run(owner.caller, (tx) =>
      attachDocument(tx, owner.caller, noopAudit, { expenseId: e.id, documentId: doc.id }),
    );
    expect(r.error).toBeUndefined();
    const after = await adminPool.query(
      "SELECT amount, currency, date, amount_base, rate, rate_source, paid_amount FROM expenses WHERE id = $1",
      [e.id],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const detail = await run(owner.caller, (tx) => getExpenseDetail(tx, e.id));
    expect(detail.data?.status).toBe("paid");
    expect(detail.data?.document?.id).toBe(doc.id);
  });

  it("refuses a second document, and a document that already became another expense", async () => {
    const a = await sekExpense();
    const doc1 = await receipt("1");
    const doc2 = await receipt("2");
    await run(owner.caller, async (tx) => {
      expect(
        (
          await attachDocument(tx, owner.caller, noopAudit, {
            expenseId: a.id,
            documentId: doc1.id,
          })
        ).error,
      ).toBeUndefined();
      const twice = await attachDocument(tx, owner.caller, noopAudit, {
        expenseId: a.id,
        documentId: doc2.id,
      });
      expect(twice.error?.message).toMatch(/already has its document/);
    });
    const b = await run(owner.caller, async (tx) => {
      const g = await createGroup(tx, owner.caller, noopAudit, {
        description: "Other",
        kind: "batch",
      });
      return createExpense(tx, owner.caller, noopAudit, {
        groupId: g.data!.id,
        date: "2026-03-17",
        description: "Other",
        basCode: "580",
        amount: "10.00",
        currency: "SEK",
        paymentSourceId: owner.sources.privateSe.id,
      });
    });
    const taken = await run(owner.caller, (tx) =>
      attachDocument(tx, owner.caller, noopAudit, { expenseId: b.data!.id, documentId: doc1.id }),
    );
    expect(taken.error?.message).toMatch(/already became/);
  });

  it("an unknown expense is not found", async () => {
    const doc = await receipt("1");
    const r = await run(owner.caller, (tx) =>
      attachDocument(tx, owner.caller, noopAudit, { expenseId: randomUUID(), documentId: doc.id }),
    );
    expect(r.error?.code).toBe("NOT_FOUND");
  });
});

describe("detachDocument", () => {
  it("removes created_from: the receipt is back in the inbox as ready, its key kept", async () => {
    const e = await sekExpense();
    const doc = await receipt("1");
    await run(owner.caller, (tx) =>
      attachDocument(tx, owner.caller, noopAudit, { expenseId: e.id, documentId: doc.id }),
    );
    const r = await run(owner.caller, (tx) =>
      detachDocument(tx, owner.caller, realAudit(tx, owner.caller), { expenseId: e.id }),
    );
    expect(r.error).toBeUndefined();
    await run(owner.caller, async (tx) => {
      expect(await inboxState(tx, doc.id)).toBe("ready");
      const d = await tx.document.findUnique({ where: { id: doc.id } });
      expect(d?.businessKey).toBe(`${e.key}_2026-03-16_`); // keys are never reused
      expect((await getExpenseDetail(tx, e.id)).data?.document).toBeNull();
    });
    const again = await run(owner.caller, (tx) =>
      detachDocument(tx, owner.caller, noopAudit, { expenseId: e.id }),
    );
    expect(again.error?.message).toMatch(/no document to remove/);
  });
});

describe("deleteExpense — occurrence_of goes with the expense (F94)", () => {
  it("an expense attributed to a subscription is deleted, the link with it", async () => {
    const e = await sekExpense();
    const subscriptionId = randomUUID();
    await adminPool.query(
      `INSERT INTO subscriptions (id, tenant_id, name, partner_id, becomes, bas_code, group_id, payment_source_id,
         cadence, start_date, created_by, updated_at)
       VALUES ($1, $2, 'Byteform', $3, 'expense', '580', $4, $5, 'monthly', '2026-01-16', $6, NOW())`,
      [
        subscriptionId,
        owner.caller.tenantId,
        randomUUID(),
        e.groupId,
        owner.sources.afSek.id,
        owner.caller.userId,
      ],
    );
    await run(owner.caller, async (tx) => {
      const link = await linking.createLink(tx, owner.caller, noopAudit, {
        from: { type: "expense", id: e.id },
        to: { type: "subscription", id: subscriptionId },
        kind: "occurrence_of",
      });
      expect(link.error).toBeUndefined();
    });
    const del = await run(owner.caller, (tx) => deleteExpense(tx, owner.caller, noopAudit, e.id));
    expect(del.data?.deleted).toBe(true);
    const left = await adminPool.query("SELECT count(*)::int AS n FROM links WHERE to_id = $1", [
      subscriptionId,
    ]);
    expect(left.rows[0].n).toBe(0);
  });
});
