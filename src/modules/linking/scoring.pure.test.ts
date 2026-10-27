// The one scorer on v1's matching fixture (specs/linking/spec.md SC-001, SC-002). v1 asserted confidence and
// reasons; the v3 result differs where the one-scorer rule changed the inputs (the partner name scores for client
// invoices too, every text field is searched, HIGH needs more than a name next to an approximate amount) — each
// deviation is written out below with the v1 value it replaces.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  daysBetween,
  partialTokens,
  proposedAllocation,
  type RowFacts,
  rank,
  scoreMatch,
} from "./scoring";
import type { Confidence, EntityFacts, LinkableType } from "./types";

type FixtureEntity = {
  id?: string;
  type: string;
  number: string;
  amount: string;
  currency: string;
  date: string;
  partner?: string;
};
type FixtureCase = {
  id: string;
  entity?: FixtureEntity;
  entities?: FixtureEntity[];
  dbFiltered?: boolean;
  transactionOverride?: {
    message?: string;
    recipient?: string | null;
    sender?: string | null;
    amount?: string;
  };
  expected?: {
    confidence?: Confidence;
    score?: number;
    reasons?: string[];
    order?: string[];
    confidences?: Confidence[];
    scores?: number[];
    candidates?: number;
  };
};
type Fixture = {
  defaultTransaction: {
    amount: string;
    currency: string;
    bookingDate: string;
    message: string;
    recipient: string | null;
    sender: string | null;
    additionalDetails: string | null;
  };
  cases: FixtureCase[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "specs", "banking", "fixtures", "matching-cases.json"),
    "utf-8",
  ),
);

const TYPE: Record<string, LinkableType> = {
  invoice: "invoice",
  supplier_invoice: "supplier_invoice",
  expense_claim: "expense",
};

function row(c: FixtureCase): RowFacts {
  const d = fixture.defaultTransaction;
  const o = c.transactionOverride ?? {};
  return {
    amount: o.amount ?? d.amount,
    currency: d.currency,
    amountBase: null,
    date: d.bookingDate,
    texts: [
      o.message ?? d.message,
      o.recipient === undefined ? (d.recipient ?? "") : (o.recipient ?? ""),
      o.sender === undefined ? (d.sender ?? "") : (o.sender ?? ""),
      d.additionalDetails ?? "",
    ],
  };
}

function entity(e: FixtureEntity): EntityFacts {
  const type = TYPE[e.type] ?? "invoice";
  return {
    type,
    id: e.id ?? e.number,
    label: e.number,
    amount: e.amount,
    currency: e.currency,
    amountBase: null,
    date: e.date,
    reference: e.number,
    // v3 expenses have no claimant (the owner reclaims); the partner belongs to invoices both ways
    partnerName: type === "expense" ? null : (e.partner ?? null),
    texts: [],
    direction: type === "invoice" ? "incoming" : "outgoing",
    remaining: e.amount,
  };
}

/** v3 results where they differ from the fixture's v1 column (the reason in the comment). */
const V3: Record<string, { confidence: Confidence; score: number; reasons: string[] }> = {
  // "Acme Corp" is the row's recipient and the invoice's client: +25 Client name match (v1 never searched the
  // partner for client invoices) — HIGH 110 → HIGH 135
  "inv-exact-same-date": {
    confidence: "HIGH",
    score: 135,
    reasons: [
      "Invoice number in message",
      "Client name match",
      "Very close amount match",
      "Same date",
    ].map((r) => (r === "Very close amount match" ? "Exact amount match" : r)),
  },
  // name + very close amount + same date: MEDIUM 60 → HIGH 85
  "inv-within-1pct": {
    confidence: "HIGH",
    score: 85,
    reasons: ["Client name match", "Very close amount match", "Same date"],
  },
  // name + exact amount + 3 days: MEDIUM 55 → HIGH 80
  "inv-3-days-before": {
    confidence: "HIGH",
    score: 80,
    reasons: ["Client name match", "Exact amount match", "Within 5 days"],
  },
  // partial number + name: HIGH 90 → HIGH 115
  "inv-partial-number": {
    confidence: "HIGH",
    score: 115,
    reasons: [
      "Partial invoice number match",
      "Client name match",
      "Exact amount match",
      "Same date",
    ],
  },
  // the whole point of the v3 rule: "ACME CORP" in the recipient is the client — MEDIUM 70 → HIGH 95
  "inv-case-insensitive-recipient": {
    confidence: "HIGH",
    score: 95,
    reasons: ["Client name match", "Exact amount match", "Same date"],
  },
  "inv-date-boundary-5-days": {
    confidence: "HIGH",
    score: 80,
    reasons: ["Client name match", "Exact amount match", "Within 5 days"],
  },
  // name + approximate amount (1 500 vs 1 000): a lead, never HIGH — LOW 40 → MEDIUM 65
  // F116 FR-002: an amount more than 10 % off is no claim — no points, no "approximate" reason
  "inv-large-amount-diff": {
    confidence: "MEDIUM",
    score: 55,
    reasons: ["Client name match", "Same date"],
  },
  // same result, v3 wording for an expense's key (`Ex213-Tr-01`); the claimant is the owner, never scored
  "expense-claim-number-and-name": {
    confidence: "HIGH",
    score: 110,
    reasons: ["Expense key in message", "Exact amount match", "Same date"],
  },
};

describe("scoreMatch — v1 matching fixture", () => {
  const scorable = fixture.cases.filter((c) => c.entity && c.expected?.confidence && !c.dbFiltered);
  expect(scorable.length).toBeGreaterThanOrEqual(10);

  for (const c of scorable) {
    const e = c.entity as FixtureEntity;
    const expected = c.expected as NonNullable<FixtureCase["expected"]>;
    it(`${c.id}: ${V3[c.id] ? "v3 deviation" : "as v1"}`, () => {
      const r = scoreMatch(row(c), entity(e));
      expect(r).not.toBeNull();
      const want = V3[c.id] ?? expected;
      expect(r?.confidence).toBe(want.confidence);
      if (want.score !== undefined) expect(r?.score).toBe(want.score);
      if (want.reasons) expect(r?.reasons).toEqual(want.reasons);
    });
  }

  it("inv-amount-boundary-1pct: 1 010 against 1 000 is still very close (relative to the entity)", () => {
    const c = fixture.cases.find((x) => x.id === "inv-amount-boundary-1pct") as FixtureCase;
    const r = scoreMatch(row(c), entity(c.entity as FixtureEntity));
    expect(r?.reasons).toContain("Very close amount match");
  });

  it("inv-ranking: HIGH before MEDIUM, then score", () => {
    const c = fixture.cases.find((x) => x.id === "inv-ranking") as FixtureCase;
    const ranked = rank(
      (c.entities as FixtureEntity[]).map((e) => {
        const cand = entity(e);
        const r = scoreMatch(row(c), cand);
        if (!r) throw new Error("not comparable");
        return { ...r, candidate: cand, allocation: null };
      }),
    );
    expect(ranked.map((r) => r.candidate.id)).toEqual(["inv-high", "inv-medium"]);
    // v1: HIGH 110 / MEDIUM 55; v3 adds the client name to both: HIGH 135 / HIGH 80
    expect(ranked.map((r) => r.score)).toEqual([135, 80]);
  });

  it("tie-same-confidence: a total order even on equal scores", () => {
    const c = fixture.cases.find((x) => x.id === "tie-same-confidence") as FixtureCase;
    const items = (c.entities as FixtureEntity[]).map((e) => {
      const cand = entity(e);
      const r = scoreMatch(row(c), cand);
      if (!r) throw new Error("not comparable");
      return { ...r, candidate: cand, allocation: null };
    });
    expect(items.map((i) => i.score)).toEqual([95, 95]); // v1 70 / 70 without the client name
    expect(rank(items).map((i) => i.candidate.id)).toEqual(["inv-tie-1", "inv-tie-2"]);
    expect(rank(items.reverse()).map((i) => i.candidate.id)).toEqual(["inv-tie-1", "inv-tie-2"]);
  });

  it("multi-entity-ranking: the supplier invoice and the client invoice score alike under one rule", () => {
    const c = fixture.cases.find((x) => x.id === "multi-entity-ranking") as FixtureCase;
    const items = (c.entities as FixtureEntity[]).map((e) => {
      const cand = entity(e);
      const r = scoreMatch(row(c), cand);
      if (!r) throw new Error("not comparable");
      return { ...r, candidate: cand, allocation: null };
    });
    // v1: supplier 95 HIGH, invoice 70 MEDIUM ("v1 searches the partner name for supplier invoices only")
    expect(items.map((i) => [i.candidate.id, i.score, i.confidence])).toEqual([
      ["inv-multi", 95, "HIGH"],
      ["sinv-multi", 95, "HIGH"],
    ]);
  });
});

describe("scoreMatch — cross-currency, partial payments, references", () => {
  const base = (over: Partial<EntityFacts> = {}): EntityFacts => ({
    type: "invoice",
    id: "i1",
    label: "VA26-INV-001",
    amount: "25000.00",
    currency: "CHF",
    amountBase: "268750.00",
    date: "2026-03-10",
    reference: "VA26-INV-001",
    partnerName: "Vaudoise Assurances",
    texts: [],
    direction: "incoming",
    remaining: "25000.00",
    ...over,
  });
  const r = (over: Partial<RowFacts> = {}): RowFacts => ({
    amount: "25000.00",
    currency: "CHF",
    amountBase: "268750.00",
    date: "2026-03-12",
    texts: ["VAUDOISE ASSURANCES", "", "", "", "Payment VA26-INV-001"],
    ...over,
  });

  it("the real thing: number, client name, exact amount, two days", () => {
    const m = scoreMatch(r(), base());
    expect(m).toMatchObject({
      score: 130,
      confidence: "HIGH",
      reference: true,
      crossCurrency: false,
    });
    expect(m?.reasons).toEqual([
      "Invoice number in message",
      "Client name match",
      "Exact amount match",
      "Within 2 days",
    ]);
  });

  it("a short payment (foreign bank fee of 20 on 25 000) is still an exact match; 200 off is very close", () => {
    const m = scoreMatch(r({ amount: "24980.00", texts: ["VAUDOISE ASSURANCES"] }), base());
    expect(m?.reasons).toContain("Exact amount match");
    expect(m?.confidence).toBe("HIGH");
    expect(scoreMatch(r({ amount: "24800.00", texts: [""] }), base())?.reasons).toContain(
      "Very close amount match",
    );
  });

  it("the row that pays exactly what is still open on a partly paid invoice is exact", () => {
    const m = scoreMatch(r({ amount: "5000.00", texts: [""] }), base({ remaining: "5000.00" }));
    expect(m?.reasons[0]).toBe("Exact amount match");
  });

  it("cross-currency: compared on the SEK bases, penalised unless a reference matched; dropped beyond 6 %", () => {
    const sekRow = r({
      currency: "SEK",
      amount: "268000.00",
      amountBase: "268000.00",
      texts: ["Vaudoise Assurances"],
    });
    const m = scoreMatch(sekRow, base());
    expect(m?.crossCurrency).toBe(true);
    expect(m?.reasons).toContain("Cross-currency match (CHF→SEK at ECB)");
    expect(m?.reasons).toContain("Currency differs but reference matches");
    const anonymous = scoreMatch({ ...sekRow, texts: [""] }, base());
    expect(anonymous?.reasons).toContain("Currency mismatch (CHF≠SEK)");
    expect(anonymous?.score).toBe((m?.score ?? 0) - 25 - 10);
    expect(scoreMatch({ ...sekRow, amountBase: "200000.00", texts: [""] }, base())).toBeNull();
    // no base on one side: only a full number keeps the candidate
    expect(scoreMatch({ ...sekRow, amountBase: null, texts: [""] }, base())).toBeNull();
    expect(
      scoreMatch({ ...sekRow, amountBase: null, texts: ["VA26-INV-001"] }, base())?.reasons,
    ).toContain("Cross-currency match (no rate to compare)");
  });

  it("partial tokens: INV-2025-042 → 042; years and the word invoice are not tokens", () => {
    expect(partialTokens("INV-2025-042")).toEqual(["042"]);
    expect(partialTokens("VA26-INV-001")).toEqual(["va26", "001"]);
    expect(partialTokens("Invoice_2024")).toEqual([]);
  });

  it("days between ISO dates ignores the clock", () => {
    expect(daysBetween("2026-03-10", "2026-03-10")).toBe(0);
    expect(daysBetween("2026-03-10", "2026-03-15")).toBe(5);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2); // DST weekend
  });
});

describe("properties (SC-002)", () => {
  const arbEntity = fc.record({
    amount: fc.integer({ min: 1, max: 1_000_000 }).map((n) => (n / 100).toFixed(2)),
    date: fc.integer({ min: 0, max: 30 }).map((d) => `2026-03-${String(1 + d).padStart(2, "0")}`),
    reference: fc.constantFrom("VA26-INV-001", "Ex213-Tr-01", "9160", null),
    partnerName: fc.constantFrom("Acme Corp", "Vaudoise", null),
  });
  const arbRow = fc.record({
    amount: fc.integer({ min: 1, max: 1_000_000 }).map((n) => (n / 100).toFixed(2)),
    date: fc.integer({ min: 0, max: 30 }).map((d) => `2026-03-${String(1 + d).padStart(2, "0")}`),
    texts: fc.array(fc.constantFrom("payment", "VA26-INV-001", "acme corp", "", "Ex213-Tr-01"), {
      maxLength: 4,
    }),
  });

  it("the score is the sum of its reasons; HIGH implies ≥ 60; the ranking is total and stable", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbRow, arbEntity), { minLength: 1, maxLength: 8 }),
        (pairs) => {
          const items = pairs.flatMap(([r, e], i) => {
            const cand: EntityFacts = {
              type: "invoice",
              id: `id-${i}`,
              label: `L${i}`,
              amount: e.amount,
              currency: "SEK",
              amountBase: e.amount,
              date: e.date,
              reference: e.reference,
              partnerName: e.partnerName,
              texts: [],
              direction: "incoming",
              remaining: e.amount,
            };
            const m = scoreMatch(
              {
                amount: r.amount,
                currency: "SEK",
                amountBase: r.amount,
                date: r.date,
                texts: r.texts,
              },
              cand,
            );
            // same currency: dropped only when the date is the one claim (F116 FR-002)
            if (!m) return [];
            if (m.confidence === "HIGH") expect(m.score).toBeGreaterThanOrEqual(60);
            // the rule as the spec states it (HIGH = score ≥ 80, or a reference with ≥ 60 unless the amount is
            // only approximate; MEDIUM ≥ 50; else LOW) — written out, not recomputed with confidenceOf (audit 31)
            const approximate = m.reasons.includes("Approximate amount match");
            const expected =
              m.score >= 80 || (m.reference && m.score >= 60 && !approximate)
                ? "HIGH"
                : m.score >= 50
                  ? "MEDIUM"
                  : "LOW";
            expect(m.confidence).toBe(expected);
            // every point is a claim (F116): no reason, no score — and a lone date is never a suggestion
            expect(m.reasons.length).toBeGreaterThan(0);
            expect(
              m.reasons.some((x) => !/^(Same date|Within \d+ days|\d+ days apart)$/.test(x)),
            ).toBe(true);
            return [{ ...m, candidate: cand, allocation: null }];
          });
          const a = rank(items).map((x) => x.candidate.id);
          const b = rank(items.slice().reverse()).map((x) => x.candidate.id);
          expect(a).toEqual(b);
          const tiers = rank(items).map((x) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 })[x.confidence]);
          expect(tiers).toEqual(tiers.slice().sort((x, y) => x - y));
        },
      ),
      { numRuns: 200 },
    );
  });
});

// F61-b (lessons audit 10): a receipt OCR read no currency on is *unknown*, never SEK — no amount points, no
// currency penalty, never dropped; reference, name and date only; and nothing to allocate.
describe("a receipt whose currency was not read (F61-b)", () => {
  const receipt: EntityFacts = {
    type: "document",
    id: "d1",
    label: "DOC-0042",
    amount: "45.90",
    currency: null,
    amountBase: null,
    date: "2026-03-10",
    reference: null,
    partnerName: "Migros",
    texts: [],
    direction: "outgoing",
    remaining: "45.90",
  };
  const row = (currency: string, amount: string, text: string): RowFacts => ({
    amount,
    currency,
    amountBase: null,
    date: "2026-03-10",
    texts: [text],
  });

  it("never scores as SEK: the same amount on a SEK row earns no amount points", () => {
    // the date alone is no suggestion (F116) — and the amount, unread, claims nothing
    expect(scoreMatch(row("SEK", "-45.90", "KORTKÖP RANDOM SHOP"), receipt)).toBeNull();
    const m = scoreMatch(row("SEK", "-45.90", "KORTKÖP MIGROS"), receipt);
    expect(m?.reasons.some((r) => /amount/i.test(r))).toBe(false);
    expect(m?.reasons.some((r) => /currency/i.test(r))).toBe(false);
    expect(m?.score).toBe(55); // the name and the date
    expect(m?.crossCurrency).toBe(false);
  });

  it("a SEK row and a CHF row score the same — the currency decides nothing", () => {
    const sek = scoreMatch(row("SEK", "-45.90", "MIGROS NEUCHATEL"), receipt);
    const chf = scoreMatch(row("CHF", "-45.90", "MIGROS NEUCHATEL"), receipt);
    expect(chf).not.toBeNull(); // not dropped as cross-currency without a base
    expect(chf?.score).toBe(sek?.score);
    expect(chf?.score).toBe(55); // name 25 + date 30, no penalty
    expect(chf?.reasons).toEqual(["Partner name match", "Same date"]);
  });

  it("is not dropped as cross-currency (a SEK-defaulted CHF pair used to be): the name still scores", () => {
    expect(scoreMatch(row("CHF", "-99.00", "MIGROS ZÜRICH"), receipt)?.score).toBe(55);
  });

  it("proposes no allocation, whatever the remainders", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (cents) => {
        const remaining = (cents / 100).toFixed(2);
        expect(
          proposedAllocation(
            { crossCurrency: false },
            { remaining, currency: "SEK" },
            { remaining, currency: null },
          ),
        ).toBeNull();
      }),
    );
    expect(
      proposedAllocation(
        { crossCurrency: false },
        { remaining: "50.00", currency: "CHF" },
        { remaining: "45.90", currency: "CHF" },
      ),
    ).toBe("45.90");
  });
});
