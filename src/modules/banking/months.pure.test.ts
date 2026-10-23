// The Months panel's pure assembly (F69): month arithmetic, the cell rule, the bars, the banner's month, link facts.
import { describe, expect, it } from "vitest";
import type { LinkDto } from "@/modules/linking";
import { addMonths, assembleMonths, linkFactsOf, monthRange, needsProof } from "./months";

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
  const base = {
    months: ["2026-06", "2026-07", "2026-08"],
    accounts: [A, B],
    covered: new Map([["a", new Set(["2026-06", "2026-07"])]]),
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
    expect(o.months.find((m) => m.month === "2026-07")).toEqual({
      month: "2026-07",
      justified: 1,
      toJustify: 1,
      built: false,
    });
  });

  it("a row makes its month imported even without a covering import period", () => {
    const o = assembleMonths({
      ...base,
      rows: [{ bankAccountId: "b", month: "2026-08", state: "no_document" }],
    });
    expect(o.cells.find((c) => c.bankAccountId === "b" && c.month === "2026-08")?.state).toBe(
      "proven",
    );
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
    note: null,
    createdAt: new Date(0),
    createdBy: "u",
    source: "web",
    ...over,
  });

  it("sums allocations from a row over the allocating kinds and marks both legs of a transfer", () => {
    const f = linkFactsOf([
      link({ allocatedAmount: "100.10" }),
      link({ allocatedAmount: "0.25", kind: "settles", to: { type: "settlement", id: "s" } }),
      link({
        kind: "transfer",
        from: { type: "bank_transaction", id: "r2" },
        to: { type: "bank_transaction", id: "r3" },
      }),
      // a manual journal entry's allocation is not a bank row's
      link({
        allocatedAmount: "9.00",
        from: { type: "journal_entry", id: "j" },
        to: { type: "invoice", id: "i" },
      }),
    ]);
    expect(f.allocated.get("r1")).toBe("100.35");
    expect(f.allocated.get("r2")).toBeUndefined();
    expect(f.allocated.has("j")).toBe(false);
    expect([...f.transfer].sort()).toEqual(["r2", "r3"]);
  });
});
