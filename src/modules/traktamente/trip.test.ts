// Traktamente — specs/traktamente US3 (the per-diem expense), US4 (the rate table: paste, copy, delete guard)
// against the real database, on the owner's 19.5-day trip.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData } from "@/kernel/db/test-fixtures";
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as expenses from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  seedRates,
  setupOwner,
  storage,
} from "@/modules/expenses/__fixtures__/harness";
import { toInstant } from "./calculator";
import { renderPerDiem } from "./jobs/render-per-diem";
import { countryOptions } from "./queries";
import {
  copyRatesFromYear,
  deleteRate,
  listRates,
  parseSkatteverketCsv,
  pasteSkatteverketCsv,
  rateYears,
  upsertRate,
} from "./rates";
import { resolvePerDiemStatement } from "./statement";
import { createOrReplacePerDiemExpense, getTrip, previewPerDiem, upsertTrip } from "./trip";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/kernel/storage/storage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/kernel/storage/storage")>();
  return { ...mod, createStorageService: () => storage };
});

const FIXTURES = join(__dirname, "..", "..", "..", "specs", "traktamente", "fixtures");
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
  await run(owner.caller, async (tx) => {
    await upsertRate(tx, owner.caller, noopAudit, {
      year: 2026,
      countryCode: "CH",
      countryNameSv: "Schweiz",
      countryNameEn: "Switzerland",
      dayAmount: "1402",
      rateSource: "test",
    });
    await upsertRate(tx, owner.caller, noopAudit, {
      year: 2026,
      countryCode: "SE",
      countryNameSv: "Sverige",
      dayAmount: "290",
      nightAmount: "145",
      mealBreakfast: "58",
      mealLunch: "102",
      mealDinner: "102",
      mealAll: "261",
    });
  });
});
afterAll(async () => {
  await adminPool.end();
});

async function tripGroup() {
  const g = await run(owner.caller, (tx) =>
    expenses.createGroup(tx, owner.caller, noopAudit, {
      description: "Travel to CH in March 2026",
    }),
  );
  return g.data!;
}

const ownerTrip = (groupId: string) => ({
  groupId,
  departureAt: "2026-03-02T09:00",
  returnAt: "2026-03-21T17:00",
  countryCode: "ch",
  agency: "SBB",
  lunches: 18,
});

describe("US3 — the per-diem expense", () => {
  it("the trip is saved with its snapshot, the group becomes a trip group, the expense is written in the group", async () => {
    const g = await tripGroup();
    expect(g.kind).toBe("batch");
    const saved = await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, realAudit(tx, owner.caller), ownerTrip(g.id)),
    );
    expect(saved.error).toBeUndefined();
    expect(saved.data?.computeError).toBeNull();
    expect(saved.data?.trip).toMatchObject({ countryCode: "CH", lunches: 18, agency: "SBB" });
    expect(saved.data?.trip.computed).toMatchObject({ days: 19.5, total: "18506.40" });
    await assertAuditLogged(
      adminPool,
      owner.caller.tenantId,
      "create",
      "trip",
      saved.data!.trip.id,
    );

    const written = await run(owner.caller, (tx) =>
      createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, { groupId: g.id, basCode: "580" }),
    );
    expect(written.error).toBeUndefined();
    expect(written.data?.expense).toMatchObject({
      key: "Ex213-Tr-01",
      kind: "per_diem",
      date: "2026-03-21",
      description: "Traktamente CH 19.5 days",
      amount: "18506.40",
      currency: "SEK",
      amountBase: "18506.40",
      rate: "1",
      rateSource: "same_currency",
      paidFromAccountId: owner.sources.privateSe.id,
      documentMissing: false,
    });
    expect(written.data?.expense.note).toContain("18 lunch(es)");
    expect(written.data?.trip.perDiemExpenseId).toBe(written.data?.expense.id);
    await run(owner.caller, async (tx) => {
      expect((await expenses.getGroup(tx, g.id)).data?.kind).toBe("trip");
      const detail = await expenses.getExpenseDetail(tx, written.data!.expense.id);
      expect(detail.data?.status).toBe("to_refund");
      const groups = await expenses.listGroups(tx);
      expect(groups[0]).toMatchObject({ hasTrip: true, openBase: "18506.40" });
    });
  });

  it("recompute: same inputs → same expense; changed meals → the open expense is replaced; settled → refused", async () => {
    const g = await tripGroup();
    await run(owner.caller, (tx) => upsertTrip(tx, owner.caller, noopAudit, ownerTrip(g.id)));
    const first = (
      await run(owner.caller, (tx) =>
        createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, {
          groupId: g.id,
          basCode: "580",
        }),
      )
    ).data!;
    const same = (
      await run(owner.caller, (tx) =>
        createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, {
          groupId: g.id,
          basCode: "580",
        }),
      )
    ).data!;
    expect(same.expense.id).toBe(first.expense.id);
    expect(same.expense.amount).toBe("18506.40");

    await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, { ...ownerTrip(g.id), lunches: 0, dinners: 2 }),
    );
    const changed = (
      await run(owner.caller, (tx) =>
        createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, {
          groupId: g.id,
          basCode: "580",
        }),
      )
    ).data!;
    expect(changed.expense.id).toBe(first.expense.id);
    expect(changed.expense.amount).toBe("26357.60"); // 27 339 − 2 × 490.70
    expect(changed.expense.key).toBe("Ex213-Tr-01");
    await run(owner.caller, async (tx) => {
      expect(
        (await expenses.listExpenses(tx, { page: 1, pageSize: 10, sort: [], filters: {} })).total,
      ).toBe(1);
    });

    // settle it → the next recompute is refused
    const [rowId] = await run(owner.caller, (tx) =>
      importRows(tx, owner.caller, owner.accounts.sek, "SEK", [
        { date: "2026-03-31", amount: "-26357.60", name: "Zikrija" },
      ]),
    );
    const settled = await run(owner.caller, (tx) =>
      expenses.confirmSettlement(tx, owner.caller, noopAudit, {
        bankTransactionId: rowId,
        lines: [{ expenseId: first.expense.id, allocatedBase: "26357.60" }],
      }),
    );
    expect(settled.error).toBeUndefined();
    await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, { ...ownerTrip(g.id), lunches: 1 }),
    );
    const refused = await run(owner.caller, (tx) =>
      createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, { groupId: g.id, basCode: "580" }),
    );
    expect(refused.error?.message).toMatch(/is settled — a correction is a new per-diem expense/);
  });

  it("a failed recomputation leaves no old snapshot (F62); a stored snapshot is parsed on read, never cast", async () => {
    const g = await tripGroup();
    const ok = await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, ownerTrip(g.id)),
    );
    expect(ok.data?.trip.computed).not.toBeNull();
    // the same trip moved into a year without rates: the old breakdown must not survive
    const failed = await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, {
        ...ownerTrip(g.id),
        departureAt: "2025-12-30T08:00",
        returnAt: "2026-01-02T21:00",
        lunches: 0,
      }),
    );
    expect(failed.data?.computeError?.message).toBe("No travel allowance rate for CH in 2025");
    expect(failed.data?.trip.computed).toBeNull();
    const stored = await adminPool.query(`SELECT computed FROM trips WHERE group_id = $1`, [g.id]);
    expect(stored.rows[0].computed).toBeNull();
    expect(await run(owner.caller, (tx) => resolvePerDiemStatement(tx, owner.caller, g.id))).toBe(
      null,
    );
    // a snapshot that does not read as a breakdown is no breakdown
    await adminPool.query(
      `UPDATE trips SET computed = '{"total": 12}'::jsonb WHERE group_id = $1`,
      [g.id],
    );
    expect((await run(owner.caller, (tx) => getTrip(tx, g.id)))?.computed).toBeNull();
    expect(await run(owner.caller, (tx) => resolvePerDiemStatement(tx, owner.caller, g.id))).toBe(
      null,
    );
    // a snapshot from before T003 holds its warnings as English lines: they read as typed warnings again
    const legacy = {
      ...ok.data!.trip.computed,
      warnings: [
        "trip spans two rate years (2025, 2026)",
        "the meal deduction exceeds the day amounts — nothing is tax-free",
        "an unknown line",
      ],
    };
    await adminPool.query(`UPDATE trips SET computed = $2::jsonb WHERE group_id = $1`, [
      g.id,
      JSON.stringify(legacy),
    ]);
    expect((await run(owner.caller, (tx) => getTrip(tx, g.id)))?.computed?.warnings).toEqual([
      {
        type: "two_rate_years",
        message: "trip spans two rate years (2025, 2026)",
        years: "2025, 2026",
      },
      {
        type: "meals_exceed_days",
        message: "the meal deduction exceeds the day amounts — nothing is tax-free",
      },
      { type: "other", message: "an unknown line" },
    ]);
  });

  it("a missing rate year is named; a day trip writes nothing; the preview is live", async () => {
    const g = await tripGroup();
    const saved = await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, {
        ...ownerTrip(g.id),
        departureAt: "2025-12-30T08:00",
        returnAt: "2026-01-02T21:00",
        lunches: 0,
      }),
    );
    expect(saved.data?.computeError?.message).toBe("No travel allowance rate for CH in 2025");
    expect(saved.data?.trip.computed).toBeNull();
    const refused = await run(owner.caller, (tx) =>
      createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, { groupId: g.id, basCode: "580" }),
    );
    expect(refused.error?.details).toEqual({ rule: "missing_rate", countryCode: "CH", year: 2025 });

    await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, {
        ...ownerTrip(g.id),
        departureAt: "2026-03-10T08:00",
        returnAt: "2026-03-10T17:00",
        lunches: 0,
      }),
    );
    await run(owner.caller, async (tx) => {
      const preview = await previewPerDiem(tx, g.id);
      expect(preview.data).toMatchObject({ days: 0, total: "0.00", reason: "no overnight stay" });
      const none = await createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, {
        groupId: g.id,
        basCode: "580",
      });
      expect(none.error?.message).toMatch(/Nothing is tax-free: no overnight stay/);
      const tooMany = await upsertTrip(tx, owner.caller, noopAudit, {
        ...ownerTrip(g.id),
        lunches: 40,
      });
      expect(tooMany.data?.computeError?.message).toMatch(/Lunches \(40\) exceed the 20 days/);
      const backwards = await upsertTrip(tx, owner.caller, noopAudit, {
        ...ownerTrip(g.id),
        departureAt: "2026-03-21T17:00",
        returnAt: "2026-03-02T09:00",
      });
      expect(backwards.error?.message).toMatch(/after the departure/);
    });
  });

  it("a recompute of unchanged inputs is a no-op: one expense, the same snapshot, one document (US3/AC2, T001)", async () => {
    const g = await tripGroup();
    await run(owner.caller, (tx) => upsertTrip(tx, owner.caller, noopAudit, ownerTrip(g.id)));
    const write = () =>
      run(owner.caller, (tx) =>
        createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, {
          groupId: g.id,
          basCode: "580",
        }),
      );
    const first = (await write()).data!;
    const render = vi.fn(async (path: string) => Buffer.from(`%PDF ${path}`));
    const data = { tenantId: owner.caller.tenantId, userId: owner.caller.userId, groupId: g.id };
    await renderPerDiem(data, render);
    const before = await adminPool.query(
      `SELECT computed, per_diem_document_id FROM trips WHERE group_id = $1`,
      [g.id],
    );
    const expenseBefore = await adminPool.query(`SELECT updated_at FROM expenses WHERE id = $1`, [
      first.expense.id,
    ]);

    const again = await write();
    expect(again.error).toBeUndefined();
    expect(again.data?.expense).toMatchObject({ id: first.expense.id, amount: "18506.40" });
    await renderPerDiem(data, render); // the action enqueues the job again — it finds the breakdown done
    expect(render).toHaveBeenCalledTimes(1);

    const after = await adminPool.query(
      `SELECT computed, per_diem_document_id FROM trips WHERE group_id = $1`,
      [g.id],
    );
    expect(after.rows[0].computed).toEqual(before.rows[0].computed); // computedAt included
    expect(after.rows[0].per_diem_document_id).toBe(before.rows[0].per_diem_document_id);
    const expenseAfter = await adminPool.query(`SELECT updated_at FROM expenses WHERE id = $1`, [
      first.expense.id,
    ]);
    expect(expenseAfter.rows[0].updated_at).toEqual(expenseBefore.rows[0].updated_at);
    const docs = await adminPool.query(
      `SELECT count(*)::int AS n FROM documents WHERE tenant_id = $1 AND prefix_type = 'expense'`,
      [owner.caller.tenantId],
    );
    expect(docs.rows[0].n).toBe(1);
  });

  it("the breakdown PDF (D29): stored as the expense's receipt, linked created_from, replaced on recompute, idempotent", async () => {
    const g = await tripGroup();
    await run(owner.caller, (tx) => upsertTrip(tx, owner.caller, noopAudit, ownerTrip(g.id)));
    const written = (
      await run(owner.caller, (tx) =>
        createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, {
          groupId: g.id,
          basCode: "580",
        }),
      )
    ).data!;
    const render = vi.fn(async (path: string) => Buffer.from(`%PDF ${path}`));
    const data = { tenantId: owner.caller.tenantId, userId: owner.caller.userId, groupId: g.id };
    await renderPerDiem(data, render);
    await renderPerDiem(data, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(`/print/per-diem/${g.id}`, expect.anything());
    const firstDoc = await run(owner.caller, async (tx) => {
      const trip = await tx.trip.findUniqueOrThrow({ where: { groupId: g.id } });
      expect(trip.perDiemDocumentId).toBeTruthy();
      const doc = await tx.document.findUniqueOrThrow({ where: { id: trip.perDiemDocumentId! } });
      expect(doc).toMatchObject({
        businessKey: "Ex213-Tr-01_2026-03-21_",
        fileName: "Ex213-Tr-01_2026-03-21_.pdf",
        status: "generated",
        prefixType: "expense",
      });
      const detail = await expenses.getExpenseDetail(tx, written.expense.id);
      expect(detail.data?.document?.id).toBe(doc.id);
      expect(detail.data?.links.map((l) => l.kind)).toEqual(["created_from"]);
      return doc.id;
    });
    // recompute → the marker clears, the job renders again, the link moves to the new document
    await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, { ...ownerTrip(g.id), lunches: 2 }),
    );
    await run(owner.caller, (tx) =>
      createOrReplacePerDiemExpense(tx, owner.caller, noopAudit, { groupId: g.id, basCode: "580" }),
    );
    await renderPerDiem(data, render);
    expect(render).toHaveBeenCalledTimes(2);
    await run(owner.caller, async (tx) => {
      const trip = await tx.trip.findUniqueOrThrow({ where: { groupId: g.id } });
      expect(trip.perDiemDocumentId).not.toBe(firstDoc);
      const detail = await expenses.getExpenseDetail(tx, written.expense.id);
      expect(detail.data?.document?.id).toBe(trip.perDiemDocumentId);
      expect(await tx.document.count({ where: { id: firstDoc } })).toBe(1); // the old one stays
    });
  });

  it("local times are stored as Stockholm instants (summer and winter)", () => {
    expect(toInstant("2026-03-02T09:00").toISOString()).toBe("2026-03-02T08:00:00.000Z");
    expect(toInstant("2026-07-01T12:30").toISOString()).toBe("2026-07-01T10:30:00.000Z");
    expect(toInstant("2026-10-25T02:30").toISOString()).toMatch(/^2026-10-25T0[01]:30:00.000Z$/);
    expect(toInstant("2026-03-02T09:00:00+01:00").toISOString()).toBe("2026-03-02T08:00:00.000Z");
  });
});

describe("US4 — the rate table", () => {
  it("parses Skatteverket's CSV: amounts in, references skipped, decimal comma accepted", () => {
    const text = readFileSync(join(FIXTURES, "skatteverket-csv-sample.csv"), "utf8");
    const parsed = parseSkatteverketCsv(text);
    expect(parsed.rows).toEqual([
      { year: 2025, countryCode: "AL", countryNameSv: "Albanien", dayAmount: "345" },
      { year: 2025, countryCode: "CH", countryNameSv: "Schweiz", dayAmount: "1402" },
    ]);
    expect(parsed.skipped).toEqual([
      { line: 4, text: "2025;Färöarna;;Se Danmark", reason: "no country code" },
    ]);
    const noYear = parseSkatteverketCsv("Tyskland;DE;774,50\nDanmark;DK;Se Sverige", 2026);
    expect(noYear.rows).toEqual([
      { year: 2026, countryCode: "DE", countryNameSv: "Tyskland", dayAmount: "774.50" },
    ]);
    expect(noYear.skipped[0].reason).toMatch(/not an amount/);
  });

  it("paste: dry run counts, the real run upserts (existing meal amounts kept); copy a year never overwrites; the delete guard", async () => {
    const text = readFileSync(join(FIXTURES, "skatteverket-csv-sample.csv"), "utf8");
    await run(owner.caller, async (tx) => {
      const dry = await pasteSkatteverketCsv(tx, owner.caller, noopAudit, { text, dryRun: true });
      expect(dry.data).toMatchObject({ created: 0, updated: 0 });
      expect(dry.data?.rows).toHaveLength(2);
      expect(await rateYears(tx)).toEqual([2026]);
      const real = await pasteSkatteverketCsv(tx, owner.caller, realAudit(tx, owner.caller), {
        text,
      });
      expect(real.data).toMatchObject({ created: 2, updated: 0 });
      const rows2025 = await listRates(tx, 2025);
      expect(rows2025.map((r) => [r.countryCode, r.dayAmount, r.rateSource])).toEqual([
        ["AL", "345.00", "skatteverket-csv"],
        ["CH", "1402.00", "skatteverket-csv"],
      ]);
      // a second paste of SE keeps the meal amounts
      await pasteSkatteverketCsv(tx, owner.caller, noopAudit, { text: "2026;Sverige;SE;300" });
      const se = (await listRates(tx, 2026)).find((r) => r.countryCode === "SE");
      expect(se).toMatchObject({ dayAmount: "300.00", mealAll: "261.00", nightAmount: "145.00" });

      const copied = await copyRatesFromYear(tx, owner.caller, noopAudit, {
        fromYear: 2025,
        toYear: 2026,
      });
      expect(copied.data).toEqual({ copied: 1, skipped: 1 }); // AL copied, CH exists
      const al = (await listRates(tx, 2026)).find((r) => r.countryCode === "AL");
      expect(al).toMatchObject({ dayAmount: "345.00", rateSource: "copied from 2025" });
      const ch = (await listRates(tx, 2026)).find((r) => r.countryCode === "CH");
      expect(ch?.dayAmount).toBe("1402.00");
      expect(await rateYears(tx)).toEqual([2026, 2025]);
      expect((await countryOptions(tx, 2026, "en")).map((c) => c.name)).toEqual([
        "Albanien",
        "Switzerland",
        "Sverige",
      ]);
      const empty = await pasteSkatteverketCsv(tx, owner.caller, noopAudit, { text: "x;y" });
      expect(empty.error?.message).toMatch(/No rate rows/);
    });

    // a trip in 2026 to CH → the CH 2026 row stays; the AL row goes
    const g = await tripGroup();
    await run(owner.caller, (tx) => upsertTrip(tx, owner.caller, noopAudit, ownerTrip(g.id)));
    await run(owner.caller, async (tx) => {
      const rows = await listRates(tx, 2026);
      const ch = rows.find((r) => r.countryCode === "CH")!;
      const al = rows.find((r) => r.countryCode === "AL")!;
      expect((await deleteRate(tx, owner.caller, noopAudit, ch.id)).error?.message).toMatch(
        /used by 1 trip/,
      );
      expect((await deleteRate(tx, owner.caller, noopAudit, al.id)).data?.deleted).toBe(true);
    });
  });

  it("the delete guard counts a rate year in Stockholm, not UTC (audit 28)", async () => {
    // a return at 00:30 on 1 January 2026 (23:30 UTC the day before) touches 2026: the CH 2026 row stays
    const g1 = await tripGroup();
    await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, {
        groupId: g1.id,
        departureAt: "2025-12-28T09:00",
        returnAt: "2026-01-01T00:30",
        countryCode: "ch",
      }),
    );
    // a departure at 00:30 on 1 January 2027 (23:30 UTC on 31 December) does not touch 2026: the SE row may go
    const g2 = await run(owner.caller, (tx) =>
      expenses.createGroup(tx, owner.caller, noopAudit, { description: "New year in SE" }),
    );
    await run(owner.caller, (tx) =>
      upsertTrip(tx, owner.caller, noopAudit, {
        groupId: g2.data!.id,
        departureAt: "2027-01-01T00:30",
        returnAt: "2027-01-03T18:00",
        countryCode: "se",
      }),
    );
    await run(owner.caller, async (tx) => {
      const rows = await listRates(tx, 2026);
      const ch = rows.find((r) => r.countryCode === "CH")!;
      const se = rows.find((r) => r.countryCode === "SE")!;
      expect((await deleteRate(tx, owner.caller, noopAudit, ch.id)).error?.message).toMatch(
        /used by 1 trip/,
      );
      expect((await deleteRate(tx, owner.caller, noopAudit, se.id)).data?.deleted).toBe(true);
    });
  });
});
