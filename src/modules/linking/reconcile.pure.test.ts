import { describe, expect, it } from "vitest";
import type { TransactionListRow } from "@/modules/banking";
import type { InboxRow } from "./inbox";
import {
  bankFxCost,
  defaultReconcileMonth,
  reconcileGroup,
  stageFields,
  twinsOf,
} from "./reconcile-pure";
import type { EntityFacts, Suggestion } from "./types";

// Invented rows and candidates (D51).
const candidate = (over: Partial<EntityFacts> = {}): EntityFacts =>
  ({
    type: "document",
    id: "doc-1",
    label: "Receipt 2604-1187",
    amount: "10.00",
    currency: "USD",
    amountBase: null,
    date: "2026-07-14",
    reference: null,
    partnerName: null,
    texts: [],
    partnerId: null,
    basCode: null,
    ...over,
  }) as EntityFacts;

const suggestion = (confidence: Suggestion["confidence"], c = candidate()): Suggestion => ({
  score: 90,
  confidence,
  reasons: ["name"],
  reference: false,
  crossCurrency: false,
  candidate: c,
  allocation: null,
});

const row = (over: {
  top?: Suggestion | null;
  list?: Partial<TransactionListRow>;
  remembered?: string | null;
}): InboxRow =>
  ({
    row: { id: "r1", amount: "99.31", currency: "SEK", direction: "outgoing" },
    accountLabel: "Main SEK",
    state: "open",
    basCode: null,
    basLabel: null,
    top: over.top ?? null,
    suggestions: over.top ? [over.top] : [],
    list: {
      partnerId: null,
      partnerName: null,
      partnerFrom: null,
      basCode: null,
      basLabel: null,
      basFrom: null,
      proposedBasCode: null,
      proposedSource: null,
      proposedConfidence: null,
      ...over.list,
    },
    rememberedPartnerId: over.remembered ?? null,
  }) as InboxRow;

describe("reconcileGroup (US1)", () => {
  it("Ready: a HIGH candidate and a known partner — the row's or the candidate's", () => {
    expect(reconcileGroup(row({ top: suggestion("HIGH"), list: { partnerId: "p1" } }))).toBe(
      "ready",
    );
    expect(reconcileGroup(row({ top: suggestion("HIGH", candidate({ partnerId: "p2" })) }))).toBe(
      "ready",
    );
  });

  it("To check: HIGH with no partner known, or not HIGH", () => {
    expect(reconcileGroup(row({ top: suggestion("HIGH") }))).toBe("check");
    expect(reconcileGroup(row({ top: suggestion("MEDIUM"), list: { partnerId: "p1" } }))).toBe(
      "check",
    );
  });

  it("no candidate: Needs a document with a partner, else Who is this?", () => {
    expect(reconcileGroup(row({ list: { partnerId: "p1" } }))).toBe("document");
    expect(reconcileGroup(row({}))).toBe("who");
  });
});

describe("stageFields — asks only about the unsure field (FR-001)", () => {
  it("sure from the row, then from the candidate", () => {
    const f = stageFields(
      row({ list: { partnerId: "p1", partnerName: "Acme", partnerFrom: "row" } }),
      suggestion("HIGH", candidate({ basCode: "6540" })),
    );
    expect(f.partner).toMatchObject({ state: "sure", value: "p1", from: "row" });
    expect(f.category).toMatchObject({ state: "sure", value: "6540", from: "candidate" });
  });

  it("proposed: the counterparty memory's partner, F98's category with its confidence", () => {
    const f = stageFields(
      row({
        remembered: "p9",
        list: { proposedBasCode: "6540", proposedSource: "memory", proposedConfidence: 0.89 },
      }),
      suggestion("HIGH"),
    );
    expect(f.partner).toMatchObject({ state: "proposed", value: "p9", from: "memory" });
    expect(f.category).toMatchObject({ state: "proposed", value: "6540", confidence: 0.89 });
  });

  it("nothing known: both asked", () => {
    const f = stageFields(row({}), null);
    expect([f.partner.state, f.category.state]).toEqual(["ask", "ask"]);
  });
});

describe("twinsOf — duplicate detection (US1)", () => {
  it("same account, day, amount and counterparty; another day or amount is not a twin", () => {
    const base = {
      accountId: "a",
      date: "2026-07-24",
      amount: "-3850.00",
      counterpartyKey: "NORDEA",
    };
    const t = twinsOf([
      { id: "1", ...base },
      { id: "2", ...base, amount: "-3850" },
      { id: "3", ...base, date: "2026-07-25" },
      { id: "4", ...base, amount: "-385.00" },
    ]);
    expect(t.get("1")).toEqual(["2"]);
    expect(t.get("2")).toEqual(["1"]);
    expect(t.has("3")).toBe(false);
    expect(t.has("4")).toBe(false);
  });
});

describe("bankFxCost (FR-001)", () => {
  it("10 USD at the ECB's 9.41 = 94.10 SEK; the bank took 99.31: 5.21 SEK, 5.5 %", () => {
    expect(
      bankFxCost({
        original: "10.00",
        originalCurrency: "USD",
        charged: "-99.31",
        rowCurrency: "SEK",
        ecbRate: "9.41",
        rateDate: "2026-07-14",
      }),
    ).toEqual({
      original: "10.00",
      originalCurrency: "USD",
      rowCurrency: "SEK",
      ecbRate: "9.410000",
      rateDate: "2026-07-14",
      ecbAmount: "94.10",
      charged: "99.31",
      bankRate: "9.931000",
      cost: "5.21",
      costPercent: "5.5",
    });
  });
});

describe("defaultReconcileMonth", () => {
  it("the oldest month with a row to justify, else this month", () => {
    const months = [
      { month: "2026-06", toJustify: 0 },
      { month: "2026-07", toJustify: 6 },
      { month: "2026-08", toJustify: 2 },
    ];
    expect(defaultReconcileMonth("2026-08", months)).toBe("2026-07");
    expect(defaultReconcileMonth("2026-08", [{ month: "2026-07", toJustify: 0 }])).toBe("2026-08");
  });
});
