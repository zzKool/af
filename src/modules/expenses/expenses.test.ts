// Expenses — specs/expenses/spec.md US1 (keys, bases, documents, locks, deletes), US2 (payment sources),
// US5 (the list) against the real database (RLS on), on the owner's fixture.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { auth } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestDocument,
} from "@/kernel/db/test-fixtures";
import type { ListQuery } from "@/kernel/list-query/types";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as documents from "@/modules/documents";
import * as linking from "@/modules/linking";
import {
  FIXTURE,
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  seedRates,
  setupOwner,
} from "./__fixtures__/harness";
import { findExpenseDuplicates } from "./duplicates";
import {
  attachBankTransaction,
  createExpense,
  deleteExpense,
  detachBankTransaction,
  isExpenseOpen,
  updateExpense,
} from "./expenses";
import { createGroup, deleteGroup } from "./groups";
import { createPaymentSource, setPaymentSourceActive } from "./payment-sources";
import {
  candidateDocuments,
  distinctExpenseValues,
  getExpenseDetail,
  ledgerSnapshot,
  listExpenses,
  listGroups,
  toExpenseDetailView,
} from "./queries";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
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
  mockHeaders = new Headers();
  await seedRates(adminPool);
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

const Q: ListQuery = { page: 1, pageSize: 50, sort: [], filters: {} };

async function group213() {
  const g = await run(owner.caller, (tx) =>
    createGroup(tx, owner.caller, noopAudit, {
      description: FIXTURE.group.description,
      kind: "trip",
    }),
  );
  expect(g.data?.number).toBe(213);
  return g.data!;
}

type Fx = (typeof FIXTURE.expenses)[number];
const fixtureInput = (groupId: string, e: Fx) => ({
  groupId,
  date: e.date,
  description: e.description,
  basCode: e.alias === "Tr" ? "580" : "583",
  amount: e.amount.toFixed(2),
  currency: e.currency as "CHF",
  paymentSourceId: owner.sources.privateCh.id,
});

describe("US2 — the four ways to pay", () => {
  it("the defaults: AF SEK / AF CHF on the main accounts, Private SE / Private CH", () => {
    expect(owner.sources.afSek).toMatchObject({
      kind: "bank_account",
      currency: "SEK",
      bankAccountId: owner.accounts.sek,
    });
    expect(owner.sources.afChf).toMatchObject({ kind: "bank_account", currency: "CHF" });
    expect(owner.sources.privateSe).toMatchObject({
      kind: "private",
      currency: "SEK",
      bankAccountId: null,
    });
    expect(owner.sources.privateCh).toMatchObject({ kind: "private", currency: "CHF" });
  });

  it("a source is validated (account currency, unique label) and deactivated, never deleted", async () => {
    await run(owner.caller, async (tx) => {
      const wrong = await createPaymentSource(tx, owner.caller, noopAudit, {
        label: "AF EUR",
        kind: "bank_account",
        bankAccountId: owner.accounts.sek,
        currency: "EUR",
      });
      expect(wrong.error?.message).toMatch(/is in SEK, not EUR/);
      const dup = await createPaymentSource(tx, owner.caller, noopAudit, {
        label: "Private SE",
        kind: "private",
        currency: "SEK",
      });
      expect(dup.error?.code).toBe("DUPLICATE_ENTRY");
      const off = await setPaymentSourceActive(
        tx,
        owner.caller,
        noopAudit,
        owner.sources.privateCh.id,
        false,
      );
      expect(off.data?.isActive).toBe(false);
    });
    const g = await group213();
    const r = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, fixtureInput(g.id, FIXTURE.expenses[0])),
    );
    expect(r.error?.message).toMatch(/Private CH is inactive/);
  });
});

describe("US1 — a receipt becomes an expense in a group", () => {
  it("keys per (group, alias), ECB bases of the fixture, the alias is a snapshot", async () => {
    const g = await group213();
    const created = await run(owner.caller, async (tx) => {
      const out = [];
      for (const e of FIXTURE.expenses) {
        const r = await createExpense(
          tx,
          owner.caller,
          realAudit(tx, owner.caller),
          fixtureInput(g.id, e),
        );
        expect(r.error).toBeUndefined();
        out.push(r.data!);
      }
      return out;
    });
    expect(created.map((e) => e.key)).toEqual(["Ex213-Tr-01", "Ex213-Tr-02", "Ex213-Rep-01"]);
    for (const [i, e] of created.entries()) {
      const fx = FIXTURE.expenses[i];
      expect(e.amountBase).toBe(fx.amount_base.toFixed(2));
      expect(e.rate).toBe(String(fx.rate));
      expect(e.rateSource).toBe("ecb_daily");
      expect(e.rateDate).toBe(fx.date);
      expect(e.baseProvisional).toBe(false);
      expect(e.kind).toBe("receipt");
    }
    await assertAuditLogged(adminPool, owner.caller.tenantId, "create", "expense", created[0].id);

    // the category changes, the key does not
    const moved = await run(owner.caller, (tx) =>
      updateExpense(tx, owner.caller, noopAudit, created[0].id, { basCode: "583" }),
    );
    expect(moved.data).toMatchObject({ key: "Ex213-Tr-01", alias: "Tr", basCode: "583" });
    // the next Tr continues the series; a fourth kind of alias starts at 01
    const next = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        date: "2026-04-01",
      }),
    );
    expect(next.data?.key).toBe("Ex213-Tr-03");
  });

  it("the base: weekend → nearest ECB day, SEK → 1, no rate → refused, a typed rate → manual", async () => {
    const g = await group213();
    await run(owner.caller, async (tx) => {
      const weekend = await createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        date: "2026-03-14",
      });
      expect(weekend.data).toMatchObject({
        rateSource: "ecb_nearest",
        rateDate: "2026-03-13",
        rate: "10.76",
      });
      expect(weekend.data?.amountBase).toBe("6456.00");
      const sek = await createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        currency: "SEK",
        amount: "123.45",
        paymentSourceId: owner.sources.privateSe.id,
      });
      expect(sek.data).toMatchObject({
        rate: "1",
        rateSource: "same_currency",
        amountBase: "123.45",
        rateDate: null,
      });
      // no USD rate at all (the nearest-day fallback needs at least one row of the pair)
      const none = await createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        currency: "USD",
      });
      expect(none.error?.message).toMatch(/No exchange rate for 2026-03-10/);
      const typed = await createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        currency: "USD",
        rate: "10.5",
      });
      expect(typed.data).toMatchObject({ rateSource: "manual", amountBase: "6300.00" });
    });
  });

  it("refuses a category without a short code, an unknown group, a foreign source", async () => {
    const g = await group213();
    await run(owner.caller, async (tx) => {
      const noAlias = await createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        basCode: "657",
      });
      expect(noAlias.error?.message).toMatch(/657 Bankkostnader has no short code/);
      const noGroup = await createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput("00000000-0000-0000-0000-000000000000", FIXTURE.expenses[0]),
      });
      expect(noGroup.error?.code).toBe("NOT_FOUND");
    });
  });

  it("company-paid: provisional ECB base until the bank row is attached (D26), then the bank's SEK + a justifies link", async () => {
    const g = await group213();
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        groupId: g.id,
        date: "2026-03-10",
        description: "ChatGPT subscription",
        basCode: "580",
        amount: "45.00",
        currency: "CHF",
        paymentSourceId: owner.sources.afSek.id,
      }),
    );
    expect(e.data).toMatchObject({
      baseProvisional: true,
      amountBase: "483.75",
      rateSource: "ecb_daily",
    });

    // the SEK card row: -523.17 SEK on 2026-03-12 (a 45 CHF receipt at the card's rate)
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-12", amount: "-523.17", details: "Kortköp 260310 OPENAI *CHATGPT SUBS" },
      ]),
    );
    const attached = await run(owner.caller, (tx) =>
      attachBankTransaction(tx, owner.caller, realAudit(tx, owner.caller), {
        expenseId: e.data!.id,
        bankTransactionId: rowId,
      }),
    );
    expect(attached.error).toBeUndefined();
    expect(attached.data).toMatchObject({
      paidAmount: "523.17",
      paidCurrency: "SEK",
      amountBase: "523.17",
      rate: "1",
      rateSource: "bank",
      baseProvisional: false,
      amount: "45.00",
      currency: "CHF",
    });
    await run(owner.caller, async (tx) => {
      const detail = await getExpenseDetail(tx, e.data!.id);
      expect(detail.data?.status).toBe("paid");
      expect(detail.data?.links.map((l) => [l.kind, l.allocatedAmount, l.currency])).toEqual([
        ["justifies", "523.17", "SEK"],
      ]);
      // what the panel's action returns: the same detail, its timestamps as ISO strings (lessons audit 29)
      if (detail.data) {
        const view = toExpenseDetailView(detail.data);
        expect(view.expense.createdAt).toBe(detail.data.expense.createdAt.toISOString());
        expect(view.group.updatedAt).toBe(detail.data.group.updatedAt.toISOString());
        expect(view.links[0]?.createdAt).toBe(detail.data.links[0]?.createdAt.toISOString());
        expect({ ...view, expense: {}, group: {}, links: [] }).toEqual({
          ...detail.data,
          expense: {},
          group: {},
          links: [],
        });
      }
      // the money facts are written now
      const change = await updateExpense(tx, owner.caller, noopAudit, e.data!.id, {
        amount: "46.00",
      });
      expect(change.error?.message).toMatch(/settled or linked/);
      const facts = await updateExpense(tx, owner.caller, noopAudit, e.data!.id, {
        note: "ok",
        basCode: "583",
      });
      expect(facts.data?.note).toBe("ok");
      const again = await attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: e.data!.id,
        bankTransactionId: rowId,
      });
      expect(again.error?.message).toMatch(/already has its bank row/);
    });
    // detach restores the estimate
    const detached = await run(owner.caller, (tx) =>
      detachBankTransaction(tx, owner.caller, noopAudit, e.data!.id),
    );
    expect(detached.data).toMatchObject({
      paidAmount: null,
      amountBase: "483.75",
      baseProvisional: true,
      rateSource: "ecb_daily",
    });
    await run(owner.caller, async (tx) => {
      expect((await getExpenseDetail(tx, e.data!.id)).data?.status).toBe("awaiting_link");
      // refusals: a private expense, an incoming row, a row on another account
      const priv = await createExpense(
        tx,
        owner.caller,
        noopAudit,
        fixtureInput(g.id, FIXTURE.expenses[0]),
      );
      const wrong = await attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: priv.data!.id,
        bankTransactionId: rowId,
      });
      expect(wrong.error?.message).toMatch(/paid privately/);
      const [inRow] = await importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-12", amount: "100.00", name: "Client" },
      ]);
      const incoming = await attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: e.data!.id,
        bankTransactionId: inRow,
      });
      expect(incoming.error?.message).toMatch(/is incoming/);
      const [chfRow] = await importRows(tx, owner.caller, owner.accounts.chf, "CHF", [
        { date: "2026-03-12", amount: "-45.00", name: "OpenAI" },
      ]);
      const other = await attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: e.data!.id,
        bankTransactionId: chfRow,
      });
      expect(other.error?.message).toMatch(/paid from AF SEK, the row is on Plusgirokonto CHF/);
    });
  });

  it("the inbox opens attach (F58, D37): a generic justifies is refused both ways, paid follows attach / detach", async () => {
    const g = await group213();
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        groupId: g.id,
        date: "2026-03-10",
        description: "Domain renewal",
        basCode: "580",
        amount: "120.00",
        currency: "SEK",
        paymentSourceId: owner.sources.afSek.id,
      }),
    );
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-10", amount: "-120.00", details: "Kortköp 260310 DOMAINS" },
      ]),
    );
    const expense = { type: "expense" as const, id: e.data!.id };
    const statusAndPaid = async () =>
      run(owner.caller, async (tx) => {
        const d = (await getExpenseDetail(tx, e.data!.id)).data!;
        return {
          status: d.status,
          paidAmount: d.expense.paidAmount,
          justifies: d.links.filter((l) => l.kind === "justifies").length,
        };
      });

    // before: the inbox's apply and a generic link write nothing — the expense would stay awaiting link for good
    await run(owner.caller, async (tx) => {
      const applied = await linking.applySuggestion(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        to: expense,
      });
      expect(applied.error?.message).toMatch(/expense's own panel/);
      expect(applied.error?.details).toEqual({ ownFlow: "expense" });
      const generic = await linking.createLink(tx, owner.caller, noopAudit, {
        from: { type: "bank_transaction", id: rowId },
        to: expense,
        kind: "justifies",
        allocatedAmount: "120.00",
        currency: "SEK",
      });
      expect(generic.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    });
    expect(await statusAndPaid()).toEqual({
      status: "awaiting_link",
      paidAmount: null,
      justifies: 0,
    });

    // what the inbox opens: attach → paid
    const attached = await run(owner.caller, (tx) =>
      attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: e.data!.id,
        bankTransactionId: rowId,
      }),
    );
    expect(attached.error).toBeUndefined();
    expect(await statusAndPaid()).toEqual({ status: "paid", paidAmount: "120.00", justifies: 1 });

    // the generic *Unlink* is refused — it would leave the paid amount and the bank base behind
    await run(owner.caller, async (tx) => {
      const [link] = (await linking.getLinksFor(tx, expense)).data!.filter(
        (l) => l.kind === "justifies",
      );
      const removed = await linking.removeLink(tx, owner.caller, noopAudit, link!.id);
      expect(removed.error?.message).toMatch(/expense's own panel/);
    });
    expect(await statusAndPaid()).toEqual({ status: "paid", paidAmount: "120.00", justifies: 1 });

    // detach removes the link and the paid amount together → awaiting link again
    const detached = await run(owner.caller, (tx) =>
      detachBankTransaction(tx, owner.caller, noopAudit, e.data!.id),
    );
    expect(detached.error).toBeUndefined();
    expect(await statusAndPaid()).toEqual({
      status: "awaiting_link",
      paidAmount: null,
      justifies: 0,
    });
  });

  it("from a document (D27): the receipt takes the expense's key, a created_from link, one origin only", async () => {
    const g = await group213();
    const doc = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      businessKey: "exp_20260310_001",
      fileName: "exp_20260310_001.pdf",
      status: "extracted",
    });
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, realAudit(tx, owner.caller), {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        documentId: doc.id,
      }),
    );
    expect(e.error).toBeUndefined();
    await run(owner.caller, async (tx) => {
      const d = await tx.document.findUnique({ where: { id: doc.id } });
      expect(d?.businessKey).toBe("Ex213-Tr-01_2026-03-10_");
      expect(d?.fileName).toBe("Ex213-Tr-01_2026-03-10_.pdf");
      const detail = await getExpenseDetail(tx, e.data!.id);
      expect(detail.data?.document?.businessKey).toBe("Ex213-Tr-01_2026-03-10_");
      expect(detail.data?.links.map((l) => l.kind)).toEqual(["created_from"]);
      const second = await createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[1]),
        documentId: doc.id,
      });
      expect(second.error?.message).toMatch(/already became expense/);
    });
    const list = await run(owner.caller, (tx) => listExpenses(tx, Q));
    expect(list.rows[0]).toMatchObject({
      key: "Ex213-Tr-01",
      hasDocument: true,
      documentMissing: false,
    });
  });

  it("deletes one whose only link is its created_from (D36): the receipt goes back to the inbox as ready, its key kept", async () => {
    const g = await group213();
    const doc = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      businessKey: "exp_20260310_001",
      fileName: "exp_20260310_001.pdf",
      status: "extracted",
    });
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        documentId: doc.id,
      }),
    );
    expect(e.error).toBeUndefined();
    const inboxState = (tx: Parameters<typeof documents.listInbox>[0]) =>
      documents
        .listInbox(tx, owner.caller)
        .then((l) => l.rows.find((r) => r.id === doc.id)?.state ?? null);
    const linkId = await run(owner.caller, async (tx) => {
      expect(await inboxState(tx)).toBeNull(); // it became something: out of the inbox
      const [origin] = await linking.linksTouching(tx, "expense", [e.data!.id]);
      return origin.id;
    });
    await run(owner.caller, async (tx) => {
      const del = await deleteExpense(tx, owner.caller, realAudit(tx, owner.caller), e.data!.id);
      expect(del.data?.deleted).toBe(true);
      expect(await linking.linksTouching(tx, "document", [doc.id])).toEqual([]);
      expect(await inboxState(tx)).toBe("ready");
      const d = await tx.document.findUnique({ where: { id: doc.id } });
      expect(d?.businessKey).toBe("Ex213-Tr-01_2026-03-10_"); // keys are never reused
    });
    await assertAuditLogged(adminPool, owner.caller.tenantId, "delete", "link", linkId);
    await assertAuditLogged(adminPool, owner.caller.tenantId, "delete", "expense", e.data!.id);
    // the document can become something again; the counter moved on
    const again = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        ...fixtureInput(g.id, FIXTURE.expenses[0]),
        documentId: doc.id,
      }),
    );
    expect(again.data?.key).toBe("Ex213-Tr-02");
  });

  it("refuses a delete when the receipt's expense also has a payment (D36): the created_from link stays", async () => {
    const g = await group213();
    const doc = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      businessKey: "exp_20260310_002",
      fileName: "exp_20260310_002.pdf",
      status: "extracted",
    });
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        groupId: g.id,
        date: "2026-03-10",
        description: "ChatGPT subscription",
        basCode: "580",
        amount: "45.00",
        currency: "CHF",
        paymentSourceId: owner.sources.afSek.id,
        documentId: doc.id,
      }),
    );
    expect(e.error).toBeUndefined();
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-12", amount: "-523.17", details: "Kortköp 260310 OPENAI *CHATGPT SUBS" },
      ]),
    );
    await run(owner.caller, async (tx) => {
      const attached = await attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: e.data!.id,
        bankTransactionId: rowId,
      });
      expect(attached.error).toBeUndefined();
      const del = await deleteExpense(tx, owner.caller, noopAudit, e.data!.id);
      expect(del.error?.message).toMatch(/settled or paid/);
      const left = await linking.linksTouching(tx, "document", [doc.id]);
      expect(left.map((l) => l.kind)).toEqual(["created_from"]);
    });
  });

  it("the dialog's receipts are the documents module's candidates: taken, filed and archived ones are not offered", async () => {
    const mk = (n: number) =>
      createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
        businessKey: `exp_20260310_00${n}`,
        fileName: `exp_20260310_00${n}.pdf`,
        status: "extracted",
      });
    const [free, filed, archived] = [await mk(1), await mk(2), await mk(3)];
    await adminPool.query(`UPDATE documents SET reviewed_at = now() WHERE id = $1`, [filed.id]);
    await adminPool.query(`UPDATE documents SET archived_at = now() WHERE id = $1`, [archived.id]);
    const ids = (await run(owner.caller, (tx) => candidateDocuments(tx, owner.caller))).map(
      (d) => d.id,
    );
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(filed.id);
    expect(ids).not.toContain(archived.id);
  });

  it("deletes: an open expense goes (key never reused), a group with expenses stays", async () => {
    const g = await group213();
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, fixtureInput(g.id, FIXTURE.expenses[0])),
    );
    await run(owner.caller, async (tx) => {
      const blocked = await deleteGroup(tx, owner.caller, noopAudit, g.id);
      expect(blocked.error?.message).toMatch(/has 1 expense/);
      const del = await deleteExpense(tx, owner.caller, realAudit(tx, owner.caller), e.data!.id);
      expect(del.data?.deleted).toBe(true);
      const next = await createExpense(
        tx,
        owner.caller,
        noopAudit,
        fixtureInput(g.id, FIXTURE.expenses[0]),
      );
      expect(next.data?.key).toBe("Ex213-Tr-02");
    });
    await assertAuditLogged(adminPool, owner.caller.tenantId, "delete", "expense", e.data!.id);
  });

  it("keys never collide or go backwards under 20 concurrent creations (SC-003)", async () => {
    const g = await group213();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        run(owner.caller, (tx) =>
          createExpense(tx, owner.caller, noopAudit, fixtureInput(g.id, FIXTURE.expenses[0])),
        ),
      ),
    );
    const keys = results.map((r) => r.data?.key).sort();
    expect(new Set(keys).size).toBe(20);
    expect(keys[0]).toBe("Ex213-Tr-01");
    expect(keys[19]).toBe("Ex213-Tr-20");
  });

  it("the lock trigger: no route changes a settled expense's money, the key is assigned once", async () => {
    const g = await group213();
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, fixtureInput(g.id, FIXTURE.expenses[0])),
    );
    await expect(
      adminPool.query(`UPDATE expenses SET key = 'Ex213-Tr-09' WHERE id = $1`, [e.data!.id]),
    ).rejects.toThrow(/expense_locked/);
    // a settlement line on it → money locked even for the superuser
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-31", amount: "-100.00", name: "Zikrija" },
      ]),
    );
    await adminPool.query(
      `INSERT INTO settlements (tenant_id, number, bank_transaction_id, payment_source_id, refund_amount, refund_currency, refund_base, allocated_base, updated_at, created_by)
       VALUES ($1, 'ST26-001', $2, $3, -100, 'SEK', 100, 100, now(), $4)`,
      [owner.caller.tenantId, rowId, owner.sources.privateCh.id, owner.caller.userId],
    );
    await adminPool.query(
      `INSERT INTO settlement_lines (tenant_id, settlement_id, expense_id, allocated_base, created_by)
       SELECT $1, id, $2, 100, $3 FROM settlements WHERE number = 'ST26-001'`,
      [owner.caller.tenantId, e.data!.id, owner.caller.userId],
    );
    await expect(
      adminPool.query(`UPDATE expenses SET amount = 601 WHERE id = $1`, [e.data!.id]),
    ).rejects.toThrow(/expense_locked/);
    await adminPool.query(`UPDATE expenses SET note = 'fine' WHERE id = $1`, [e.data!.id]);
    await expect(
      adminPool.query(`DELETE FROM expenses WHERE id = $1`, [e.data!.id]),
    ).rejects.toThrow(/settlement_lines/);
  });

  it("the lock trigger matches isOpen (D37, F62): a paid (linked) expense's money is locked in the DB; detach reopens it", async () => {
    const g = await group213();
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, {
        groupId: g.id,
        date: "2026-03-10",
        description: "ChatGPT subscription",
        basCode: "580",
        amount: "45.00",
        currency: "CHF",
        paymentSourceId: owner.sources.afSek.id,
      }),
    );
    const id = e.data!.id;
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-12", amount: "-523.17", details: "Kortköp 260310 OPENAI *CHATGPT SUBS" },
      ]),
    );
    const attached = await run(owner.caller, (tx) =>
      attachBankTransaction(tx, owner.caller, noopAudit, {
        expenseId: id,
        bankTransactionId: rowId,
      }),
    );
    expect(attached.error).toBeUndefined();
    expect(await run(owner.caller, (tx) => isExpenseOpen(tx, id))).toBe(false);
    // the database itself refuses, whatever the route (superuser, no service)
    await expect(
      adminPool.query(`UPDATE expenses SET amount = 46 WHERE id = $1`, [id]),
    ).rejects.toThrow(/expense_locked/);
    await expect(
      adminPool.query(`UPDATE expenses SET amount_base = 1 WHERE id = $1`, [id]),
    ).rejects.toThrow(/expense_locked/);
    await expect(
      adminPool.query(`UPDATE expenses SET paid_amount = 1 WHERE id = $1`, [id]),
    ).rejects.toThrow(/expense_locked/);
    await adminPool.query(`UPDATE expenses SET note = 'fine' WHERE id = $1`, [id]);
    // the service says why, and refuses the delete for the same reason
    await run(owner.caller, async (tx) => {
      const del = await deleteExpense(tx, owner.caller, noopAudit, id);
      expect(del.error?.message).toMatch(/settled or paid/);
    });
    // detach takes the link off first, then rewrites the money: open again, in the DB too
    const detached = await run(owner.caller, (tx) =>
      detachBankTransaction(tx, owner.caller, noopAudit, id),
    );
    expect(detached.error).toBeUndefined();
    expect(await run(owner.caller, (tx) => isExpenseOpen(tx, id))).toBe(true);
    await adminPool.query(`UPDATE expenses SET amount = 46 WHERE id = $1`, [id]);
  });
});

describe("the duplicate check (specs/documents US3): the same bytes, a similar expense", () => {
  it("hash → high through created_from; same merchant ± 1 % ± 7 days → medium; acknowledged → note + audit", async () => {
    const g = await group213();
    const hash = "a".repeat(64);
    const original = await createTestDocument(
      adminPool,
      owner.caller.tenantId,
      owner.caller.userId,
      {
        businessKey: "exp_20260310_010",
        status: "extracted",
        contentHash: hash,
      },
    );
    const copy = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
      businessKey: "exp_20260310_011",
      status: "extracted",
      contentHash: hash,
    });
    const hotel = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, realAudit(tx, owner.caller), {
        ...fixtureInput(g.id, FIXTURE.expenses[0]), // Hotel 600 CHF 2026-03-10
        documentId: original.id,
      }),
    );
    expect(hotel.error).toBeUndefined();

    await run(owner.caller, async (tx) => {
      // B: the copy's bytes already became the hotel expense
      const byHash = await findExpenseDuplicates(tx, { documentId: copy.id });
      expect(byHash).toHaveLength(1);
      expect(byHash[0]).toMatchObject({
        kind: "hash",
        confidence: "high",
        entityId: hotel.data!.id,
      });
      expect(byHash[0].reason.params).toEqual({ kind: "expense", key: "Ex213-Tr-01" });

      // C′: same merchant, 1 % off, 5 days later, same currency → medium; other currency → nothing
      const near = await findExpenseDuplicates(tx, {
        merchant: " hotel ",
        amount: "605.00",
        currency: "CHF",
        date: "2026-03-15",
      });
      expect(near.map((m) => [m.kind, m.confidence])).toEqual([["fuzzy", "medium"]]);
      const otherCurrency = await findExpenseDuplicates(tx, {
        merchant: "Hotel",
        amount: "600.00",
        currency: "SEK",
        date: "2026-03-10",
      });
      expect(otherCurrency).toEqual([]);
      const nothing = await findExpenseDuplicates(tx, {
        documentId: original.id,
        merchant: "Taxi",
      });
      expect(nothing).toEqual([]);
    });

    // "Create anyway" with a note: the note on the expense, the acknowledgement in the audit row
    const anyway = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, realAudit(tx, owner.caller), {
        ...fixtureInput(g.id, FIXTURE.expenses[1]),
        documentId: copy.id,
        note: "second night",
        duplicateAck: { entityIds: [hotel.data!.id], note: "two rooms, two receipts" },
      }),
    );
    expect(anyway.error).toBeUndefined();
    expect(anyway.data?.note).toBe("Not a duplicate: two rooms, two receipts\nsecond night");
    const audit = await adminPool.query(
      "SELECT new_data FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'create'",
      [owner.caller.tenantId, anyway.data!.id],
    );
    expect(audit.rows[0].new_data.duplicateAck).toEqual({
      entityIds: [hotel.data!.id],
      note: "two rooms, two receipts",
    });
  });
});

describe("US5 — the list, the groups, the ledger", () => {
  it("rows with derived status, Excel-semantics distinct values, sums; groups with totals; the ledger", async () => {
    const g = await group213();
    await run(owner.caller, async (tx) => {
      for (const e of FIXTURE.expenses)
        await createExpense(tx, owner.caller, noopAudit, fixtureInput(g.id, e));
      await createExpense(tx, owner.caller, noopAudit, {
        groupId: g.id,
        date: "2026-03-10",
        description: "Company card",
        basCode: "580",
        amount: "45.00",
        currency: "CHF",
        paymentSourceId: owner.sources.afSek.id,
      });
    });
    await run(owner.caller, async (tx) => {
      const all = await listExpenses(tx, Q);
      expect(all.total).toBe(4);
      expect(all.rows.map((r) => r.status).sort()).toEqual([
        "awaiting_link",
        "to_refund",
        "to_refund",
        "to_refund",
      ]);
      expect(all.sums?.amountBase).toBe("11248.75");
      // no Σ of the amounts: the set mixes CHF and SEK, the footer would label it with one currency (F71)
      expect(all.sums?.amount).toBeUndefined();
      const open = await listExpenses(tx, {
        ...Q,
        filters: { status: { kind: "in", values: ["to_refund"] } },
      });
      expect(open.total).toBe(3);
      expect(open.sums?.openBase).toBe("10765.00");
      const payers = await distinctExpenseValues(tx, "paymentSourceLabel", {
        ...Q,
        filters: { status: { kind: "in", values: ["to_refund"] } },
      });
      expect(payers.map((v) => v.value)).toEqual(["Private CH"]);
      const search = await listExpenses(tx, { ...Q, search: "hotel" });
      expect(search.rows.map((r) => r.key)).toEqual(["Ex213-Tr-01"]);
      const byGroup = await listExpenses(tx, Q, { groupId: g.id });
      expect(byGroup.total).toBe(4);

      const groups = await listGroups(tx);
      expect(groups[0]).toMatchObject({
        number: 213,
        label: "213 — Travel to CH in March 2026",
        expenseCount: 4,
        openBase: "10765.00",
        perCurrency: [{ currency: "CHF", amount: "1045.00" }],
        hasTrip: false,
      });

      const ledger = await ledgerSnapshot(tx);
      expect(ledger.total).toEqual({ openBase: "10765.00", allocatedBase: "0.00", openCount: 3 });
      expect(ledger.sources.find((s) => s.label === "Private CH")).toMatchObject({
        openBase: "10765.00",
        openCount: 3,
      });
      expect(ledger.awaitingLinkCount).toBe(1);
    });
  });

  it("the panel's History: the expense's audit trail, newest first, the changed fields named (F71)", async () => {
    const g = await group213();
    const e = await run(owner.caller, (tx) =>
      createExpense(
        tx,
        owner.caller,
        realAudit(tx, owner.caller),
        fixtureInput(g.id, FIXTURE.expenses[0]),
      ),
    );
    await run(owner.caller, (tx) =>
      updateExpense(tx, owner.caller, realAudit(tx, owner.caller), e.data!.id, {
        note: "Booked online",
        basCode: "583",
      }),
    );
    // an amount edit is named too — the trail keeps money as decimal strings (F84)
    await run(owner.caller, (tx) =>
      updateExpense(tx, owner.caller, realAudit(tx, owner.caller), e.data!.id, {
        amount: "6500.00",
      }),
    );
    await run(owner.caller, async (tx) => {
      const history = (await getExpenseDetail(tx, e.data!.id)).data!.history;
      expect(history[0]?.action).toBe("update");
      expect(history[0]?.fields).toContain("amount");
      expect(history.slice(1).map((h) => [h.action, h.fields])).toEqual([
        ["update", ["basCode", "note"]],
        ["create", []],
      ]);
    });
  });

  it("RLS: another tenant sees nothing", async () => {
    const g = await group213();
    const e = await run(owner.caller, (tx) =>
      createExpense(tx, owner.caller, noopAudit, fixtureInput(g.id, FIXTURE.expenses[0])),
    );
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    await withTenantTransaction(prisma, other.tenantId, async (tx) => {
      expect((await listExpenses(tx, Q)).total).toBe(0);
      expect((await getExpenseDetail(tx, e.data!.id)).error?.code).toBe("NOT_FOUND");
      expect(await linking.getLinkable("expense")?.exists(tx, e.data!.id)).toBe(false);
    });
  });
});
