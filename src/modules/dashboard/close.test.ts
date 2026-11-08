// Work's read on the real modules (F137, FR-004 – FR-005): a small invented world (D51) on 2026-07-15 — June with
// a rate every weekday, one SEK row to justify, one private expense, no package; May built on 3 June; a client
// invoiced in June's window and not yet in July's → the close of June, the past months, the streak, the reminder,
// *Also waiting* without the close's own items.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { cleanupTestData, createTestDocument } from "@/kernel/db/test-fixtures";
import * as expenses from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  run,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import * as invoices from "@/modules/invoices";
import * as packageModule from "@/modules/package";
import * as partners from "@/modules/partners";
import { workData } from "./close";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;
const TODAY = "2026-07-15";

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  // a rate on every day from 1 May to today, but Mon 6 – Wed 8 July (a gap of three weekdays)
  for (
    let d = new Date("2026-05-01T00:00:00Z");
    d <= new Date(`${TODAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10);
    if (["2026-07-06", "2026-07-07", "2026-07-08"].includes(date)) continue;
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 11), ($1, 'EUR/CHF', 0.95), ($1, 'EUR/USD', 1.1)`,
      [date],
    );
  }
  owner = await setupOwner(adminPool, nordeaFormatId);
});
afterAll(async () => {
  await adminPool.end();
});

/** a month's package built at `at` — through the package module's own steps, a stored zip behind it */
async function built(period: string, at: string) {
  const zip = await createTestDocument(adminPool, owner.caller.tenantId, owner.caller.userId, {
    documentType: "generated",
    status: "generated",
    mimeType: "application/zip",
  });
  await run(owner.caller, async (tx) => {
    const b = await packageModule.requestBuild(tx, owner.caller, noopAudit, { period });
    if (b.error) throw new Error(b.error.message);
    await packageModule.markBuilding(tx, b.data?.id as string);
    await packageModule.markBuilt(tx, noopAudit, b.data?.id as string, {
      documentId: zip.id,
      counts: packageModule.EMPTY_COUNTS,
      flags: 0,
      notes: "",
      builtAt: new Date(at),
    });
  });
}

async function world() {
  const caller = owner.caller;
  await run(caller, async (tx) => {
    await importRows(tx, caller, owner.accounts.sek, "SEK", [
      { date: "2026-06-12", amount: "-250.00", name: "INVENTED CAFE" },
    ]);
    const trip = await expenses.createGroup(tx, caller, noopAudit, {
      description: "Basel",
      kind: "trip",
    });
    const e = await expenses.createExpense(tx, caller, noopAudit, {
      groupId: trip.data?.id as string,
      date: "2026-06-03",
      description: "Train",
      basCode: "580",
      amount: "80.00",
      currency: "CHF",
      paidFromAccountId: owner.sources.privateCh.id,
    });
    if (e.error) throw new Error(e.error.message);
    // a client with a draft dated 2 June — the invoice for May's work; nothing yet for June's
    const client = await partners.createPartner(tx, caller, noopAudit, {
      name: "Invented Client AG",
      shortCode: "IC",
      types: ["client"],
      defaultCurrency: "CHF",
      defaultLanguage: "en",
      address: { country: "CH" },
    });
    const draft = await invoices.createDraft(tx, caller, noopAudit, "2026-06-02", {
      partnerId: client.data?.id as string,
      issueDate: "2026-06-02",
    });
    if (draft.error) throw new Error(draft.error.message);
  });
  await built("2026-05", "2026-06-03T09:00:00Z");
  await built("2026-04", "2026-05-05T09:00:00Z");
}

describe("workData (F137)", () => {
  it("opens on June (last month, not built): rates done, the statements current, the package waiting", async () => {
    await world();
    const w = await run(owner.caller, (tx) => workData(tx, owner.caller, TODAY, null));
    expect(w.close.month).toBe("2026-06");
    expect(w.close.steps.map((s) => `${s.kind}:${s.state}`)).toEqual([
      "rates:done",
      "statements:current",
      "justified:todo",
      "expenses:todo",
      "closed:waiting",
    ]);
    expect(w.close.rates).toEqual({ weekdays: 22, missing: 0 });
    // the two main accounts, the savings left out (yearly); no balance in the CSV → no chain
    expect(w.close.accounts.map((a) => [a.label, a.complete])).toEqual([
      ["Plusgirokonto CHF", false],
      ["Plusgirokonto SEK", false],
    ]);
    expect(w.close.rows).toEqual({ justified: 0, toJustify: 1 });
    expect(w.close.privateExpenses).toBe(1);
    expect(w.close.builtOn).toBeNull();
    expect(w.close.percent).toBe(20);
    expect(w.close.next).toBe("2026-07");
    // the client invoiced in May's window (2 June), nothing since → reminded for June
    expect(w.close.reminders.map((r) => [r.partnerName, r.lastIssueDate])).toEqual([
      ["Invented Client AG", "2026-06-02"],
    ]);
  });

  it("the past months with the day each was built, the streak; Also waiting leaves the close's items out", async () => {
    await world();
    const w = await run(owner.caller, (tx) => workData(tx, owner.caller, TODAY, null));
    expect(w.past.map((m) => [m.month, m.builtOn])).toEqual([
      ["2026-06", null],
      ["2026-05", "2026-06-03"],
      ["2026-04", "2026-05-05"],
      ["2026-03", null],
      ["2026-02", null],
      ["2026-01", null],
    ]);
    // June still open does not break the run of May and April
    expect(w.streak).toBe(2);
    const kinds = w.alsoWaiting.map((i) => i.kind);
    expect(kinds).not.toContain("rows_to_justify");
    expect(kinds).not.toContain("package_not_built");
    expect(kinds).toContain("owner_liability");
  });

  it("July asked: the gap of 6 – 8 July makes the rates the current step; built June → July by default", async () => {
    await world();
    await built("2026-06", "2026-07-04T09:00:00Z");
    const w = await run(owner.caller, (tx) => workData(tx, owner.caller, TODAY, null));
    expect(w.close.month).toBe("2026-07");
    expect(w.close.rates.missing).toBe(3);
    expect(w.close.steps[0]?.state).toBe("current");
    expect(w.close.next).toBeNull();
    expect(w.streak).toBe(3);
    const june = await run(owner.caller, (tx) => workData(tx, owner.caller, TODAY, "2026-06"));
    expect(june.close.builtOn).toBe("2026-07-04");
    expect(june.close.steps.find((s) => s.kind === "expenses")?.state).toBe("done");
    // a month after this one is read as this month
    const later = await run(owner.caller, (tx) => workData(tx, owner.caller, TODAY, "2027-01"));
    expect(later.close.month).toBe("2026-07");
  });
});
