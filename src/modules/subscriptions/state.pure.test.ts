// F94 SC-003 (specs/subscriptions US2-2 … US2-5): the state table written out row by row — never recomputed with
// the function under test — then a property: one state, marks only where the table allows them.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { attribute, nearestPeriod } from "./attribution";
import { periodAt } from "./periods";
import { periodState, type StateInput } from "./state";
import type { EntityFact, PeriodMark, PeriodState } from "./types";

const sub = { startDate: "2026-01-14", endDate: null, cadence: "monthly" as const, prices: [] };
const period = periodAt({ ...sub, pauses: [] }, "2026-10-14"); // rows 10-11 … 10-21, receipts 10-04 … 10-24
const paused = periodAt(
  { ...sub, pauses: [{ fromDate: "2026-10-01", toDate: "2026-10-31" }] },
  "2026-10-14",
);

const expense = (o: Partial<EntityFact> = {}): EntityFact => ({
  type: "expense",
  id: "e1",
  key: "Ex220-IT-10",
  date: "2026-10-15",
  amount: "199.00",
  currency: "SEK",
  hasDocument: false,
  needsPayment: true,
  paid: false,
  overdue: false,
  status: "awaiting_link",
  ...o,
});
const bill = (o: Partial<EntityFact> = {}): EntityFact =>
  expense({
    type: "supplier_invoice",
    key: "SI221-Acc-10",
    status: "unpaid",
    hasDocument: true,
    ...o,
  });

const input = (o: Partial<StateInput>): StateInput => ({
  period,
  becomes: "expense",
  privatePaid: false,
  entities: [],
  rowOffered: false,
  documentOffered: false,
  today: "2026-10-16",
  ...o,
});

const TABLE: [string, Partial<StateInput>, PeriodState, PeriodMark[]][] = [
  ["paused, nothing attributed", { period: paused }, "skipped", []],
  ["more than 3 days ahead", { today: "2026-10-10" }, "upcoming", []],
  [
    "ahead, but the receipt / bill came early: due, to confirm",
    { today: "2026-10-05", documentOffered: true },
    "due",
    ["match_waiting"],
  ],
  ["3 days ahead: due", { today: "2026-10-11" }, "due", []],
  ["due, a row offered", { rowOffered: true }, "due", ["match_waiting"]],
  ["due, a receipt offered", { documentOffered: true }, "due", ["match_waiting"]],
  ["due, row window open", { today: "2026-10-21" }, "due", []],
  ["due, row window closed", { today: "2026-10-22" }, "due", ["charge_missing"]],
  [
    "private: no row to wait for, receipt window open",
    { privatePaid: true, today: "2026-10-22" },
    "due",
    [],
  ],
  [
    "private: receipt window closed",
    { privatePaid: true, today: "2026-10-25" },
    "due",
    ["receipt_missing"],
  ],
  ["bill not in, window open", { becomes: "supplier_invoice", today: "2026-10-24" }, "due", []],
  [
    "bill not in, window closed",
    { becomes: "supplier_invoice", today: "2026-10-25" },
    "due",
    ["bill_missing"],
  ],
  ["bill period: a row is no offer", { becomes: "supplier_invoice", rowOffered: true }, "due", []],
  ["expense paid, no receipt", { entities: [expense({ paid: true })] }, "charged", []],
  [
    "charged, receipt window closed",
    { entities: [expense({ paid: true })], today: "2026-10-25" },
    "charged",
    ["receipt_missing"],
  ],
  [
    "charged, a receipt offered",
    { entities: [expense({ paid: true })], documentOffered: true },
    "charged",
    ["match_waiting"],
  ],
  [
    "expense documented, not paid",
    { entities: [expense({ hasDocument: true })] },
    "documented",
    [],
  ],
  [
    "documented, row window closed",
    { entities: [expense({ hasDocument: true })], today: "2026-10-22" },
    "documented",
    ["charge_missing"],
  ],
  [
    "documented, a row offered",
    { entities: [expense({ hasDocument: true })], rowOffered: true },
    "documented",
    ["match_waiting"],
  ],
  [
    "done: paid and documented",
    { entities: [expense({ paid: true, hasDocument: true })] },
    "done",
    [],
  ],
  [
    "private expense documented = done",
    { privatePaid: true, entities: [expense({ needsPayment: false, hasDocument: true })] },
    "done",
    [],
  ],
  ["bill recorded, unpaid", { becomes: "supplier_invoice", entities: [bill()] }, "documented", []],
  [
    "bill overdue: its own word, not a to-do",
    { becomes: "supplier_invoice", entities: [bill({ overdue: true })], today: "2026-12-01" },
    "documented",
    ["overdue"],
  ],
  ["bill paid", { becomes: "supplier_invoice", entities: [bill({ paid: true })] }, "done", []],
  [
    "an entity wins over a pause",
    { period: paused, entities: [expense({ paid: true, hasDocument: true })] },
    "done",
    [],
  ],
  [
    "two charges",
    { entities: [expense({ paid: true, hasDocument: true }), expense({ id: "e2" })] },
    "done",
    ["two_charges"],
  ],
  [
    "recorded, neither paid nor documented, row window closed",
    { entities: [expense()], today: "2026-10-22" },
    "due",
    ["charge_missing"],
  ],
];

describe("the state table (US2-2, US2-4)", () => {
  it.each(TABLE)("%s", (_name, o, state, marks) => {
    expect(periodState(input(o))).toEqual({ state, marks });
  });
});

describe("property (SC-003)", () => {
  it("one state; to-do marks only on due / charged / documented; deleting the entity → due or later", () => {
    const entity = fc.record({
      hasDocument: fc.boolean(),
      needsPayment: fc.boolean(),
      paid: fc.boolean(),
      overdue: fc.boolean(),
      type: fc.constantFrom("expense" as const, "supplier_invoice" as const),
    });
    fc.assert(
      fc.property(
        fc.option(entity, { nil: null }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: -20, max: 40 }),
        (e, rowOffered, documentOffered, privatePaid, offset) => {
          const today = new Date(Date.UTC(2026, 9, 14 + offset)).toISOString().slice(0, 10);
          const entities = e ? [expense(e)] : [];
          const r = periodState(
            input({ entities, rowOffered, documentOffered, privatePaid, today }),
          );
          const todo = r.marks.filter((m) => m !== "overdue" && m !== "two_charges");
          if (todo.length > 0) expect(["due", "charged", "documented"]).toContain(r.state);
          if (r.state === "done" || r.state === "upcoming" || r.state === "skipped")
            expect(todo).toEqual([]);
          if (e) {
            const without = periodState(input({ rowOffered, documentOffered, privatePaid, today }));
            expect(["due", "upcoming"]).toContain(without.state);
          }
        },
      ),
    );
  });
});

describe("attribution (US2-5)", () => {
  const dates = ["2026-09-14", "2026-10-14", "2026-11-14"];
  it("the nearest expected date; a tie goes to the earlier period; before the start → the first", () => {
    expect(nearestPeriod(dates, "2026-10-16")).toBe(1);
    expect(nearestPeriod(dates, "2026-09-29")).toBe(0); // 15 days from both? 09-14 → 15, 10-14 → 15: earlier
    expect(nearestPeriod(dates, "2026-01-01")).toBe(0);
    expect(nearestPeriod([], "2026-01-01")).toBe(-1);
  });
  it("two entities in one period, oldest first", () => {
    const m = attribute(dates, [
      { id: "b", date: "2026-10-18" },
      { id: "a", date: "2026-10-12" },
      { id: "c", date: "2026-11-15" },
    ]);
    expect(m.get(1)?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(m.get(2)?.map((e) => e.id)).toEqual(["c"]);
  });
});
