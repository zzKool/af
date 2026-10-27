// The Months panel's pure assembly (F69): month arithmetic, the cell rule, the bars, the banner's month, link facts.
import { describe, expect, it } from "vitest";
import type { LinkDto } from "@/modules/linking";
import type { Completeness } from "./completeness";
import { linkFactsOf } from "./link-facts";
import { addMonths, assembleMonths, monthRange, needsProof } from "./months";

const A = { id: "a", label: "SEK", role: "main" as const, currency: "SEK" };
const B = { id: "b", label: "Sparkonto", role: "savings" as const, currency: "SEK" };

describe("month arithmetic", () => {
  it("crosses year ends both ways", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-07", -11)).toBe("2025-08");
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("open and partially linked need proof; linked and no document needed do not", () => {
    expect(["open", "partial", "linked", "no_document"].map((s) => needsProof(s as never))).toEqual(
      [true, true, false, false],
    );
  });
});

describe("assembleMonths", () => {
  // the balance chain of `a` (F115) holds from the end of May to the end of July: June and July can be proven
  const chainA: Completeness = {
    completeFrom: "2026-05-31",
    completeTo: "2026-07-31",
    gaps: [],
    balancedDays: 9,
  };
  const base = {
    months: ["2026-06", "2026-07", "2026-08"],
    accounts: [A, B],
    covered: new Map([["a", new Set(["2026-06", "2026-07"])]]),
    completeness: new Map([["a", chainA]]),
    built: new Set<string>(),
    thisMonth: "2026-08",
  };

  it("a cell is open with one row to justify, proven when all are justified or the import had none, else not imported", () => {
    const o = assembleMonths({
      ...base,
      rows: [
        { bankAccountId: "a", month: "2026-07", state: "linked" },
        { bankAccountId: "a", month: "2026-07", state: "partial" },
      ],
    });
    const cell = (acc: string, m: string) =>
      o.cells.find((c) => c.bankAccountId === acc && c.month === m);
    expect(cell("a", "2026-07")).toMatchObject({ state: "open", rows: 2, toJustify: 1 });
    expect(cell("a", "2026-06")).toMatchObject({ state: "proven", rows: 0 });
    expect(cell("a", "2026-08")?.state).toBe("not_imported");
    expect(cell("b", "2026-07")?.state).toBe("not_imported");
    expect(o.accounts.find((a) => a.id === "a")).toMatchObject({
      completeTo: "2026-07-31",
      gaps: 0,
    });
    expect(o.accounts.find((a) => a.id === "b")).toMatchObject({ completeTo: null, gaps: 0 });
    expect(o.months.find((m) => m.month === "2026-07")).toEqual({
      month: "2026-07",
      justified: 1,
      toJustify: 1,
      built: false,
    });
  });

  it("a row makes its month imported even without a covering import period — justified but incomplete: no balance chain proves the month whole (F115)", () => {
    const o = assembleMonths({
      ...base,
      rows: [{ bankAccountId: "b", month: "2026-08", state: "no_document" }],
    });
    expect(o.cells.find((c) => c.bankAccountId === "b" && c.month === "2026-08")?.state).toBe(
      "incomplete",
    );
  });

  it("never proven on half a month (F115): the chain must start before the month and reach its last day; a gap ends it", () => {
    const rows = [
      { bankAccountId: "a", month: "2026-06", state: "linked" as const },
      { bankAccountId: "a", month: "2026-07", state: "linked" as const },
    ];
    const cell = (o: ReturnType<typeof assembleMonths>, m: string) =>
      o.cells.find((c) => c.bankAccountId === "a" && c.month === m)?.state;
    // the chain reaches 2026-07-15 only: June proven, July incomplete
    const half = assembleMonths({
      ...base,
      rows,
      completeness: new Map([["a", { ...chainA, completeTo: "2026-07-15" }]]),
    });
    expect([cell(half, "2026-06"), cell(half, "2026-07")]).toEqual(["proven", "incomplete"]);
    // the first export starts on June 2nd: June is not proven — a row of June 1st could be missing
    const lateStart = assembleMonths({
      ...base,
      rows,
      completeness: new Map([["a", { ...chainA, completeFrom: "2026-06-02" }]]),
    });
    expect([cell(lateStart, "2026-06"), cell(lateStart, "2026-07")]).toEqual([
      "incomplete",
      "proven",
    ]);
    // no balance at all (another bank's CSV): nothing is ever proven
    const none = assembleMonths({ ...base, rows, completeness: new Map() });
    expect([cell(none, "2026-06"), cell(none, "2026-07")]).toEqual(["incomplete", "incomplete"]);
  });

  it("the banner names the newest closed month with rows and no built package — never the running month", () => {
    const rows = [
      { bankAccountId: "a", month: "2026-06", state: "open" as const },
      { bankAccountId: "a", month: "2026-07", state: "linked" as const },
      { bankAccountId: "a", month: "2026-08", state: "open" as const },
    ];
    expect(assembleMonths({ ...base, rows }).banner).toEqual({
      month: "2026-07",
      withoutProof: 0,
    });
    expect(assembleMonths({ ...base, rows, built: new Set(["2026-07"]) }).banner).toEqual({
      month: "2026-06",
      withoutProof: 1,
    });
    expect(
      assembleMonths({ ...base, rows, built: new Set(["2026-06", "2026-07"]) }).banner,
    ).toBeNull();
  });
});

describe("linkFactsOf", () => {
  const link = (over: Partial<LinkDto>): LinkDto => ({
    id: "l",
    tenantId: "t",
    from: { type: "bank_transaction", id: "r1" },
    to: { type: "document", id: "d" },
    kind: "justifies",
    allocatedAmount: null,
    currency: null,
    allocatedBase: null,
    note: null,
    createdAt: new Date(0),
    createdBy: "u",
    source: "web",
    ...over,
  });

  const rows = [
    { id: "r1", amount: "-500.00", currency: "SEK", amountBase: "-500.00" },
    { id: "r2", amount: "-10.00", currency: "SEK", amountBase: "-10.00" },
    { id: "r3", amount: "10.00", currency: "SEK", amountBase: "10.00" },
  ];

  it("sums allocations from a row over the allocating kinds and marks both legs of a transfer", () => {
    const f = linkFactsOf(
      [
        link({ allocatedAmount: "100.10", currency: "SEK" }),
        link({
          allocatedAmount: "0.25",
          currency: "SEK",
          kind: "settles",
          to: { type: "expense", id: "s" },
        }),
        link({
          kind: "transfer",
          from: { type: "bank_transaction", id: "r2" },
          to: { type: "bank_transaction", id: "r3" },
        }),
        // another source's allocation is not a bank row's
        link({
          allocatedAmount: "9.00",
          from: { type: "expense", id: "x" },
          to: { type: "document", id: "d" },
        }),
      ],
      rows,
    );
    expect(f.allocated.get("r1")).toBe("100.35");
    expect(f.allocated.get("r2")).toBeUndefined();
    expect(f.allocated.has("j")).toBe(false);
    expect([...f.transfer].sort()).toEqual(["r2", "r3"]);
  });

  it("a cross-currency link counts by the share of the row's base it took (F114) — the list's rule", () => {
    // a SEK row of −500.00 paid a CHF 45.00 invoice: the link carries the 500.00 SEK the row gave → justified
    const f = linkFactsOf(
      [link({ allocatedAmount: "45.00", currency: "CHF", allocatedBase: "500.00" })],
      rows,
    );
    expect(f.allocated.get("r1")).toBe("500.00");
    // half the row's base → half the row
    const half = linkFactsOf(
      [link({ allocatedAmount: "22.50", currency: "CHF", allocatedBase: "250.00" })],
      rows,
    );
    expect(half.allocated.get("r1")).toBe("250.00");
  });
});
