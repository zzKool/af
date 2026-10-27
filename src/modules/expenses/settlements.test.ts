// Settlements — specs/expenses/spec.md US3 (the ledger), US4 (propose, confirm, variants A / B / C, refusals,
// cancel, the statement job) against the real database on real bank rows (Nordea import) and the fixture rates.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as banking from "@/modules/banking";
import {
  FIXTURE,
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  seedRates,
  setupOwner,
  storage,
} from "./__fixtures__/harness";
import { createExpense, updateExpense } from "./expenses";
import { createGroup } from "./groups";
import { renderStatement } from "./jobs/render-statement";
import {
  getExpenseDetail,
  ledgerSnapshot,
  listExpenses,
  listGroups,
  listSettlements,
  resolveStatement,
  settleableTransactions,
} from "./queries";
import {
  activeSettlementTransactionIds,
  cancelSettlement,
  confirmSettlement,
  openPrivateExpenses,
  proposeSettlement,
} from "./settlements";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/kernel/storage/storage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/kernel/storage/storage")>();
  return { ...mod, createStorageService: () => storage };
});

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
let expenseIds: Record<string, string>;

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
  // the fixture's three private CHF expenses in group 213
  expenseIds = await run(owner.caller, async (tx) => {
    const g = await createGroup(tx, owner.caller, noopAudit, {
      description: FIXTURE.group.description,
      kind: "trip",
    });
    const ids: Record<string, string> = {};
    for (const e of FIXTURE.expenses) {
      const r = await createExpense(tx, owner.caller, noopAudit, {
        groupId: g.data!.id,
        date: e.date,
        description: e.description,
        basCode: e.alias === "Tr" ? "580" : "583",
        amount: e.amount.toFixed(2),
        currency: "CHF",
        paidFromAccountId: owner.sources.privateCh.id,
      });
      if (r.error) throw new Error(r.error.message);
      ids[r.data.key] = r.data.id;
    }
    return ids;
  });
});
afterAll(async () => {
  await adminPool.end();
});

/** The refund row of a variant, imported on the right account. */
async function refundRow(variant: "A" | "B" | "C"): Promise<string> {
  const spec =
    variant === "A"
      ? { account: owner.accounts.sek, currency: "SEK", date: "2026-03-31", amount: "-9700.00" }
      : variant === "B"
        ? { account: owner.accounts.chf, currency: "CHF", date: "2026-03-31", amount: "-1000.00" }
        : { account: owner.accounts.chf, currency: "CHF", date: "2026-04-01", amount: "-1000.00" };
  const [id] = await run(owner.caller, (tx) =>
    importRows(tx, owner.caller, spec.account, spec.currency, [
      { date: spec.date, amount: spec.amount, name: "Zikrija", message: "Utlägg mars" },
    ]),
  );
  return id;
}

const statuses = async () =>
  run(owner.caller, async (tx) => {
    const out: Record<string, string> = {};
    for (const [key, id] of Object.entries(expenseIds)) {
      out[key] = (await getExpenseDetail(tx, id)).data?.status ?? "?";
    }
    return out;
  });

describe("US3 — what the company owes the owner", () => {
  it("the ledger before: 10 765.00 open, 3 expenses, all to_refund", async () => {
    const ledger = await run(owner.caller, (tx) => ledgerSnapshot(tx));
    expect(ledger.total).toEqual({ openBase: "10765.00", allocatedBase: "0.00", openCount: 3 });
    expect(await statuses()).toEqual({
      "Ex213-Tr-01": "to_refund",
      "Ex213-Tr-02": "to_refund",
      "Ex213-Rep-01": "to_refund",
    });
    const open = await run(owner.caller, (tx) => openPrivateExpenses(tx));
    expect(open.map((e) => [e.key, e.openBase])).toEqual([
      ["Ex213-Tr-01", "6450.00"],
      ["Ex213-Tr-02", "1620.00"],
      ["Ex213-Rep-01", "2695.00"],
    ]);
  });
});

describe("F62 — one owed rule, one Σ of active lines", () => {
  it("a 0.30 residual is rounding, not a debt: the list's open sum = the ledger's = 0.00", async () => {
    // 10 765.00 open in all; a refund of 10 764.70 leaves 0.30 on the last expense by FIFO
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-31", amount: "-10764.70", name: "Zikrija", message: "Utlägg mars" },
      ]),
    );
    const p = (await run(owner.caller, (tx) => proposeSettlement(tx, { bankTransactionId: rowId })))
      .data!;
    expect(p.lines.map((l) => [l.key, l.remainingOpen])).toEqual([
      ["Ex213-Tr-01", "0.00"],
      ["Ex213-Tr-02", "0.00"],
      ["Ex213-Rep-01", "0.30"],
    ]);
    const s = await run(owner.caller, (tx) =>
      confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: p.paidFromAccountId!,
        lines: p.lines.map((l) => ({ expenseId: l.expenseId, allocatedBase: l.allocatedBase })),
      }),
    );
    expect(s.error).toBeUndefined();
    await run(owner.caller, async (tx) => {
      const ledger = await ledgerSnapshot(tx);
      const list = await listExpenses(tx, { page: 1, pageSize: 50, sort: [], filters: {} });
      expect(ledger.total).toMatchObject({ openBase: "0.00", openCount: 0 });
      expect(list.sums?.openBase).toBe(ledger.total.openBase);
      const rep = list.rows.find((r) => r.key === "Ex213-Rep-01");
      expect(rep).toMatchObject({ status: "refunded", allocatedBase: "2694.70", openBase: "0.00" });
      const groups = await listGroups(tx);
      expect(groups[0]?.openBase).toBe("0.00");
      expect((await getExpenseDetail(tx, rep!.id)).data?.openBase).toBe("0.00");
      // and nothing is proposed again
      expect(await openPrivateExpenses(tx)).toEqual([]);
      // F88 (D47): the statement prints owed, like the list and the ledger — 0.00, not the 0.30 remainder
      const st = await resolveStatement(tx, owner.caller, s.data?.id ?? "");
      expect(st?.lines.map((l) => [l.key, l.remainingOpen])).toEqual([
        ["Ex213-Tr-01", "0.00"],
        ["Ex213-Tr-02", "0.00"],
        ["Ex213-Rep-01", "0.00"],
      ]);
      expect(st?.totals.residualOpen).toBe(ledger.total.openBase);
    });
    expect(await statuses()).toEqual({
      "Ex213-Tr-01": "refunded",
      "Ex213-Tr-02": "refunded",
      "Ex213-Rep-01": "refunded",
    });
  });

  it("statement_superseded is derived: a statement stored after the cancel still reads superseded", async () => {
    const rowId = await refundRow("A");
    const p = (await run(owner.caller, (tx) => proposeSettlement(tx, { bankTransactionId: rowId })))
      .data!;
    const s = (
      await run(owner.caller, (tx) =>
        confirmSettlement(tx, owner.caller, noopAudit, {
          bankTransactionId: rowId,
          paidFromAccountId: p.paidFromAccountId!,
          lines: p.lines.map((l) => ({ expenseId: l.expenseId, allocatedBase: l.allocatedBase })),
        }),
      )
    ).data!;
    const cancelled = await run(owner.caller, (tx) =>
      cancelSettlement(tx, owner.caller, noopAudit, s.id),
    );
    expect(cancelled.data?.statementSuperseded).toBe(false);
    // the job's store lands after the cancel (it rendered while the settlement was active)
    await adminPool.query(
      `UPDATE settlements SET statement_document_id = gen_random_uuid() WHERE id = $1`,
      [s.id],
    );
    const list = await run(owner.caller, (tx) => listSettlements(tx));
    expect(list.find((r) => r.id === s.id)?.statementSuperseded).toBe(true);
    const st = await run(owner.caller, (tx) => resolveStatement(tx, owner.caller, s.id));
    expect(st?.statementSuperseded).toBe(true);
  });
});

describe("US4 — settle a refund", () => {
  it("variant A: FIFO proposal, confirmation, ST26-001, the settles link, statuses and ledger after", async () => {
    const rowId = await refundRow("A");
    const proposal = await run(owner.caller, (tx) =>
      proposeSettlement(tx, { bankTransactionId: rowId }),
    );
    expect(proposal.error).toBeUndefined();
    const p = proposal.data!;
    expect(p).toMatchObject({
      refundAmount: "-9700.00",
      refundCurrency: "SEK",
      refundBase: "9700.00",
      paidFromAccountId: owner.sources.privateCh.id,
      allocatedBase: "9700.00",
      exchangeDifferenceBase: "0.00",
      roundingBase: "0.00",
      residualOpen: "1065.00",
      unallocatedOnTransaction: "0.00",
    });
    expect(p.lines.map((l) => [l.key, l.allocatedBase, l.remainingOpen])).toEqual([
      ["Ex213-Tr-01", "6450.00", "0.00"],
      ["Ex213-Tr-02", "1620.00", "0.00"],
      ["Ex213-Rep-01", "1630.00", "1065.00"],
    ]);
    // the picker lists the row until it settles
    expect((await run(owner.caller, (tx) => settleableTransactions(tx))).map((t) => t.id)).toEqual([
      rowId,
    ]);

    const confirmed = await run(owner.caller, (tx) =>
      confirmSettlement(tx, owner.caller, realAudit(tx, owner.caller), {
        bankTransactionId: rowId,
        paidFromAccountId: p.paidFromAccountId!,
        lines: p.lines.map((l) => ({ expenseId: l.expenseId, allocatedBase: l.allocatedBase })),
      }),
    );
    expect(confirmed.error).toBeUndefined();
    const s = confirmed.data!;
    expect(s).toMatchObject({
      number: "ST26-001",
      refundAmount: "-9700.00",
      refundBase: "9700.00",
      allocatedBase: "9700.00",
      exchangeDifferenceBase: "0.00",
      roundingBase: "0.00",
      status: "active",
      statementDocumentId: null,
    });
    expect(s.lines).toHaveLength(3);
    expect(s.lines.every((l) => l.note === null)).toBe(true);
    await assertAuditLogged(adminPool, owner.caller.tenantId, "create", "settlement", s.id);

    expect(await statuses()).toEqual({
      "Ex213-Tr-01": "refunded",
      "Ex213-Tr-02": "refunded",
      "Ex213-Rep-01": "partially_refunded",
    });
    await run(owner.caller, async (tx) => {
      const ledger = await ledgerSnapshot(tx);
      expect(ledger.total).toEqual({ openBase: "1065.00", allocatedBase: "9700.00", openCount: 1 });
      const t = await banking.getTransaction(tx, rowId);
      expect(t.data?.state).toBe("linked");
      expect(t.data?.links.map((l) => [l.kind, Number(l.allocatedAmount), l.otherLabel])).toEqual([
        ["settles", 9700, "ST26-001 · 9700.00 SEK · 9700.00 SEK settled"],
      ]);
      expect((await settleableTransactions(tx)).length).toBe(0);
      const again = await proposeSettlement(tx, { bankTransactionId: rowId });
      expect(again.error?.message).toMatch(/already settles ST26-001/);
      const list = await listSettlements(tx);
      expect(list[0]).toMatchObject({
        number: "ST26-001",
        payerLabel: "Private CH",
        bookingDate: "2026-03-31",
        lineCount: 3,
      });
      // the residual, later: a second settlement takes the 1 065 → ST26-002
      const detail = await getExpenseDetail(tx, expenseIds["Ex213-Rep-01"]);
      expect(detail.data?.settlements).toEqual([
        {
          id: s.id,
          number: "ST26-001",
          allocatedBase: "1630.00",
          status: "active",
          bookingDate: "2026-03-31",
        },
      ]);
    });
  });

  it("variant B: a CHF refund booked at 10.70 — the +65.00 exchange difference is confirmed explicitly", async () => {
    const rowId = await refundRow("B");
    const lines = FIXTURE.variant_B_full_chf_refund_exchange_difference.allocations.map(
      (a: { expense: string; allocated_base: number }) => ({
        expenseId: expenseIds[a.expense],
        allocatedBase: a.allocated_base.toFixed(2),
      }),
    );
    const refused = await run(owner.caller, (tx) =>
      confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateCh.id,
        lines,
      }),
    );
    expect(refused.error?.message).toBe(
      "Allocations exceed the refund by 65.00 SEK — confirm the exchange difference",
    );
    const ok = await run(owner.caller, (tx) =>
      confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateCh.id,
        lines,
        confirmExchangeDifference: true,
        exchangeDifferenceBasCode: "657",
      }),
    );
    expect(ok.error).toBeUndefined();
    expect(ok.data).toMatchObject({
      number: "ST26-001",
      refundAmount: "-1000.00",
      refundCurrency: "CHF",
      refundBase: "10700.00",
      allocatedBase: "10765.00",
      exchangeDifferenceBase: "65.00",
      roundingBase: "0.00",
      exchangeDifferenceBasCode: "657",
    });
    expect(await statuses()).toEqual({
      "Ex213-Tr-01": "refunded",
      "Ex213-Tr-02": "refunded",
      "Ex213-Rep-01": "refunded",
    });
    const ledger = await run(owner.caller, (tx) => ledgerSnapshot(tx));
    expect(ledger.total).toEqual({ openBase: "0.00", allocatedBase: "10765.00", openCount: 0 });
  });

  it("variant C: 0.30 within the tolerance is rounding, no confirmation, the note on the last line", async () => {
    const rowId = await refundRow("C"); // -1000 CHF at 10.7647 = 10 764.70
    const lines = Object.values(expenseIds).map((id, i) => ({
      expenseId: id,
      allocatedBase: FIXTURE.expenses[i].amount_base.toFixed(2),
    }));
    const ok = await run(owner.caller, (tx) =>
      confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateCh.id,
        lines,
      }),
    );
    expect(ok.error).toBeUndefined();
    expect(ok.data).toMatchObject({
      refundBase: "10764.70",
      allocatedBase: "10765.00",
      exchangeDifferenceBase: "0.00",
      roundingBase: "0.30",
    });
    const notes = ok.data!.lines.map((l) => l.note);
    expect(notes.filter(Boolean)).toEqual([
      "Rounding adjustment: SEK 0.30 (Swedish 50-öre rounding tolerance)",
    ]);
    expect(await statuses()).toEqual({
      "Ex213-Tr-01": "refunded",
      "Ex213-Tr-02": "refunded",
      "Ex213-Rep-01": "refunded",
    });
  });

  it("refusals (US4-5): over an expense's open base, a company-paid expense, an incoming row, a savings row, a duplicate line", async () => {
    const rowId = await refundRow("A");
    await run(owner.caller, async (tx) => {
      const over = await confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateCh.id,
        lines: [{ expenseId: expenseIds["Ex213-Tr-02"], allocatedBase: "1620.01" }],
      });
      expect(over.error?.message).toMatch(/Ex213-Tr-02: 1620.01 exceeds its open 1620.00 SEK/);
      const dup = await confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateCh.id,
        lines: [
          { expenseId: expenseIds["Ex213-Tr-02"], allocatedBase: "100.00" },
          { expenseId: expenseIds["Ex213-Tr-02"], allocatedBase: "100.00" },
        ],
      });
      expect(dup.error?.message).toMatch(/appears twice/);
      const g = await tx.expenseGroup.findFirstOrThrow();
      const company = await createExpense(tx, owner.caller, noopAudit, {
        groupId: g.id,
        date: "2026-03-10",
        description: "Card",
        basCode: "580",
        amount: "10.00",
        currency: "SEK",
        paidFromAccountId: owner.sources.afSek.id,
      });
      const companyPaid = await confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateCh.id,
        lines: [{ expenseId: company.data!.id, allocatedBase: "10.00" }],
      });
      expect(companyPaid.error?.message).toMatch(
        /paid from AF SEK — a company-paid expense is never settled/,
      );
      const sourceMismatch = await confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateSe.id,
        lines: [{ expenseId: expenseIds["Ex213-Tr-02"], allocatedBase: "100.00" }],
      });
      expect(sourceMismatch.error?.message).toMatch(/belongs to Private CH, not Private SE/);
      const [incoming] = await importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-31", amount: "500.00", name: "Client" },
      ]);
      const inc = await proposeSettlement(tx, { bankTransactionId: incoming });
      expect(inc.error?.message).toMatch(/is incoming/);
      const [savings] = await importRows(tx, owner.caller, owner.accounts.sav, "SEK", [
        { date: "2026-03-31", amount: "-500.00", name: "Zikrija" },
      ]);
      const sav = await proposeSettlement(tx, { bankTransactionId: savings });
      expect(sav.error?.message).toMatch(/savings account/);
      const companySource = await confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.afSek.id,
        lines: [{ expenseId: expenseIds["Ex213-Tr-02"], allocatedBase: "100.00" }],
      });
      expect(companySource.error?.message).toMatch(/is a company account/);
    });
    // nothing was numbered by the refusals
    const ok = await run(owner.caller, (tx) =>
      confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: owner.sources.privateCh.id,
        lines: [{ expenseId: expenseIds["Ex213-Tr-02"], allocatedBase: "1620.00" }],
      }),
    );
    expect(ok.data?.number).toBe("ST26-001");
  });

  it("cancel (US4-6): the link goes, the balances reopen, the number stays; the money of a settled expense was locked meanwhile", async () => {
    const rowId = await refundRow("A");
    const p = (await run(owner.caller, (tx) => proposeSettlement(tx, { bankTransactionId: rowId })))
      .data!;
    const s = (
      await run(owner.caller, (tx) =>
        confirmSettlement(tx, owner.caller, noopAudit, {
          bankTransactionId: rowId,
          paidFromAccountId: p.paidFromAccountId!,
          lines: p.lines.map((l) => ({ expenseId: l.expenseId, allocatedBase: l.allocatedBase })),
        }),
      )
    ).data!;
    await run(owner.caller, async (tx) => {
      const locked = await updateExpense(tx, owner.caller, noopAudit, expenseIds["Ex213-Tr-01"], {
        amount: "601.00",
      });
      expect(locked.error?.message).toMatch(/settled or linked/);
      // the row is taken while the settlement is active (lessons audit 23 — the pickers' read API)
      expect(await activeSettlementTransactionIds(tx)).toEqual(new Set([rowId]));
      expect(await activeSettlementTransactionIds(tx, [rowId])).toEqual(new Set([rowId]));
      expect(await activeSettlementTransactionIds(tx, [])).toEqual(new Set());
    });
    const cancelled = await run(owner.caller, (tx) =>
      cancelSettlement(tx, owner.caller, realAudit(tx, owner.caller), s.id),
    );
    expect(cancelled.data).toMatchObject({
      number: "ST26-001",
      status: "cancelled",
      statementSuperseded: false,
    });
    expect(cancelled.data?.cancelledAt).toBeInstanceOf(Date);
    expect(await statuses()).toEqual({
      "Ex213-Tr-01": "to_refund",
      "Ex213-Tr-02": "to_refund",
      "Ex213-Rep-01": "to_refund",
    });
    await run(owner.caller, async (tx) => {
      expect((await ledgerSnapshot(tx)).total.openBase).toBe("10765.00");
      expect((await banking.getTransaction(tx, rowId)).data?.state).toBe("open");
      // a cancelled settlement frees its row
      expect(await activeSettlementTransactionIds(tx, [rowId])).toEqual(new Set());
      const twice = await cancelSettlement(tx, owner.caller, noopAudit, s.id);
      expect(twice.error?.message).toMatch(/already cancelled/);
      // a new settlement on the same row gets the next number
      const next = await confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        paidFromAccountId: p.paidFromAccountId!,
        lines: p.lines.map((l) => ({ expenseId: l.expenseId, allocatedBase: l.allocatedBase })),
      });
      expect(next.data?.number).toBe("ST26-002");
    });
    // a cancelled settlement is never deleted, nor its number changed (trigger + no grant)
    await expect(
      adminPool.query(`UPDATE settlements SET number = 'ST26-009' WHERE id = $1`, [s.id]),
    ).rejects.toThrow(/settlement_locked/);
    await expect(
      adminPool.query(`UPDATE settlements SET status = 'active' WHERE id = $1`, [s.id]),
    ).rejects.toThrow(/settlement_locked/);
  });

  it("the statement job (US4-7): stored once as Reimb_{number}_{date}.pdf, referenced, linked to the refund; idempotent", async () => {
    const rowId = await refundRow("A");
    const p = (await run(owner.caller, (tx) => proposeSettlement(tx, { bankTransactionId: rowId })))
      .data!;
    const s = (
      await run(owner.caller, (tx) =>
        confirmSettlement(tx, owner.caller, noopAudit, {
          bankTransactionId: rowId,
          paidFromAccountId: p.paidFromAccountId!,
          lines: p.lines.map((l) => ({ expenseId: l.expenseId, allocatedBase: l.allocatedBase })),
        }),
      )
    ).data!;
    const render = vi.fn(async (path: string) => Buffer.from(`%PDF ${path}`));
    const data = {
      tenantId: owner.caller.tenantId,
      userId: owner.caller.userId,
      settlementId: s.id,
    };
    await renderStatement(data, render);
    await renderStatement(data, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(`/print/settlement/${s.id}`, expect.anything());
    await run(owner.caller, async (tx) => {
      const row = await tx.settlement.findUniqueOrThrow({ where: { id: s.id } });
      expect(row.statementDocumentId).toBeTruthy();
      const doc = await tx.document.findUniqueOrThrow({ where: { id: row.statementDocumentId! } });
      expect(doc).toMatchObject({
        businessKey: "Reimb_ST26-001_2026-03-31.pdf",
        status: "generated",
        documentType: "financial",
        prefixType: "expense",
        mimeType: "application/pdf",
      });
      const t = await banking.getTransaction(tx, rowId);
      expect(
        t.data?.links.map((l) => [l.kind, l.otherLabel?.includes("Reimb_ST26-001") ?? false]),
      ).toEqual([
        ["settles", false],
        ["justifies", true],
      ]);
      // the statement data the print route renders
      const st = await resolveStatement(tx, owner.caller, s.id);
      expect(st?.number).toBe("ST26-001");
      expect(st?.lines.map((l) => [l.key, l.allocatedBase, l.remainingOpen])).toEqual([
        ["Ex213-Tr-01", "6450.00", "0.00"],
        ["Ex213-Tr-02", "1620.00", "0.00"],
        ["Ex213-Rep-01", "1630.00", "1065.00"],
      ]);
      expect(st?.totals).toMatchObject({ allocatedBase: "9700.00", residualOpen: "1065.00" });
      expect(st?.refund).toMatchObject({
        bookingDate: "2026-03-31",
        amount: "-9700.00",
        currency: "SEK",
        account: "Plusgirokonto SEK",
      });
      expect(st?.payee).toBe("Private CH");
    });
    // cancelling afterwards flags the statement superseded; a second statement_document_id is refused
    const cancelled = await run(owner.caller, (tx) =>
      cancelSettlement(tx, owner.caller, noopAudit, s.id),
    );
    expect(cancelled.data?.statementSuperseded).toBe(true);
    await expect(
      adminPool.query(
        `UPDATE settlements SET statement_document_id = gen_random_uuid() WHERE id = $1`,
        [s.id],
      ),
    ).rejects.toThrow(/settlement_locked/);
    // the job on a cancelled settlement without a statement does nothing (lessons audit 31: a real cancelled
    // settlement — the freed row settles again as ST26-002, cancelled before its job runs)
    const again = (
      await run(owner.caller, (tx) =>
        confirmSettlement(tx, owner.caller, noopAudit, {
          bankTransactionId: rowId,
          paidFromAccountId: owner.sources.privateCh.id,
          lines: p.lines.map((l) => ({ expenseId: l.expenseId, allocatedBase: l.allocatedBase })),
        }),
      )
    ).data;
    expect(again?.number).toBe("ST26-002");
    await run(owner.caller, (tx) => cancelSettlement(tx, owner.caller, noopAudit, again?.id ?? ""));
    render.mockClear();
    await renderStatement({ ...data, settlementId: again?.id ?? "" }, render);
    expect(render).not.toHaveBeenCalled();
    await run(owner.caller, async (tx) => {
      const row = await tx.settlement.findUniqueOrThrow({ where: { id: again?.id ?? "" } });
      expect(row).toMatchObject({ status: "cancelled", statementDocumentId: null });
    });
    // nor on an unknown id
    await renderStatement(
      { ...data, settlementId: "00000000-0000-0000-0000-000000000000" },
      render,
    );
    expect(render).not.toHaveBeenCalled();
  });
});
