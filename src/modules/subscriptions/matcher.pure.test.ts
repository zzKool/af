// F94 (specs/subscriptions US3-1…3, US3-7, US4-1): the row and document matchers, at their edges. Invented values.
import { describe, expect, it } from "vitest";
import {
  type MatchDocument,
  type MatchRow,
  type MatchSubscription,
  markAmbiguity,
  matchDocument,
  matchRow,
} from "./matcher";
import { periodAt } from "./periods";
import type { RowMatch } from "./types";

const prices = [{ validFrom: "2026-01-15", validTo: null, amount: "199.00", currency: "SEK" }];
const sekPeriod = periodAt(
  { startDate: "2026-01-15", endDate: null, cadence: "monthly", prices, pauses: [] },
  "2026-10-15",
); // rows 10-12 … 10-22, receipts 10-05 … 10-25
const eurPeriod = periodAt(
  {
    startDate: "2026-01-14",
    endDate: null,
    cadence: "monthly",
    prices: [{ validFrom: "2026-01-14", validTo: null, amount: "22.00", currency: "EUR" }],
    pauses: [],
  },
  "2026-10-14",
);

const sub: MatchSubscription = {
  partnerId: "p-byteform",
  partnerName: "Byteform AB",
  partnerVatNumber: "SE556000000101",
  matchText: "BYTEFORM",
  tolerancePct: "5.00",
  basCode: "6540",
  bankAccountId: "acc-sek",
};
const row = (o: Partial<MatchRow> = {}): MatchRow => ({
  id: "r1",
  bankAccountId: "acc-sek",
  bookingDate: "2026-10-16",
  amount: "199.00",
  currency: "SEK",
  texts: ["BYTEFORM AB", "Kortköp 261016"],
  description: "BYTEFORM AB",
  journalPartnerId: null,
  journalBasCode: null,
  noDocumentNeeded: false,
  ...o,
});
const noRate = () => null;
/** EUR → SEK 11.50 every day; nothing else */
const rateOf = (_d: string, from: string, to: string) =>
  from === "EUR" && to === "SEK" ? "11.50" : null;

describe("matchRow (US3-1…3)", () => {
  it("text in any field, same currency, exact amount → an exact match", () => {
    for (const texts of [["BYTEFORM AB"], ["x", "Payment byteform"], ["", "", "BYTEFORM*SUBS"]]) {
      expect(matchRow(sekPeriod, sub, row({ texts }), noRate)).toMatchObject({
        rowId: "r1",
        exact: true,
        byText: true,
        crossCurrency: false,
        diffPct: "0.00",
      });
    }
  });
  it("the journal's partner instead of the text (a rule already named the vendor) — not exact", () => {
    const r = matchRow(
      sekPeriod,
      { ...sub, matchText: null },
      row({ texts: ["KORTKÖP"], journalPartnerId: "p-byteform" }),
      noRate,
    );
    expect(r).toMatchObject({ byText: false, exact: false });
    expect(
      matchRow(sekPeriod, { ...sub, matchText: null }, row({ texts: ["KORTKÖP"] }), noRate),
    ).toBeNull();
  });
  it("the tolerance boundary: 5 % in, 5.01 % out; 0.5 % is still exact, 0.51 % is not", () => {
    expect(matchRow(sekPeriod, sub, row({ amount: "208.95" }), noRate)?.diffPct).toBe("5.00");
    expect(matchRow(sekPeriod, sub, row({ amount: "208.98" }), noRate)).toBeNull();
    expect(matchRow(sekPeriod, sub, row({ amount: "199.99" }), noRate)?.exact).toBe(true); // 0.497 %
    expect(matchRow(sekPeriod, sub, row({ amount: "200.02" }), noRate)?.exact).toBe(false); // 0.513 %
  });
  it("the window edges: −3 and +7 days in, one day more out", () => {
    expect(matchRow(sekPeriod, sub, row({ bookingDate: "2026-10-12" }), noRate)).not.toBeNull();
    expect(matchRow(sekPeriod, sub, row({ bookingDate: "2026-10-22" }), noRate)).not.toBeNull();
    expect(matchRow(sekPeriod, sub, row({ bookingDate: "2026-10-11" }), noRate)).toBeNull();
    expect(matchRow(sekPeriod, sub, row({ bookingDate: "2026-10-23" }), noRate)).toBeNull();
  });
  it("another account, a private payer, a period without a price: never", () => {
    expect(matchRow(sekPeriod, sub, row({ bankAccountId: "acc-chf" }), noRate)).toBeNull();
    expect(matchRow(sekPeriod, { ...sub, bankAccountId: null }, row(), noRate)).toBeNull();
    expect(matchRow({ ...sekPeriod, price: null }, sub, row(), noRate)).toBeNull();
  });
  it("cross-currency: the EUR price converted into the row's SEK at the ECB rate; no rate → no match; never exact", () => {
    // 22.00 EUR × 11.50 = 253.00 SEK; the card charged 257.10 (1.62 % FX markup)
    const r = matchRow(
      eurPeriod,
      sub,
      row({ bookingDate: "2026-10-15", amount: "257.10" }),
      rateOf,
    );
    expect(r).toMatchObject({ crossCurrency: true, exact: false, diffPct: "1.62" });
    expect(
      matchRow(eurPeriod, sub, row({ bookingDate: "2026-10-15", amount: "257.10" }), noRate),
    ).toBeNull();
    expect(
      matchRow(eurPeriod, sub, row({ bookingDate: "2026-10-15", amount: "290.00" }), rateOf),
    ).toBeNull(); // 14.6 %
  });
  it("hints, never blocking: a rule said no document; the journal's category differs", () => {
    expect(
      matchRow(sekPeriod, sub, row({ noDocumentNeeded: true, journalBasCode: "6570" }), noRate)
        ?.hints,
    ).toEqual(["rule_no_document", "category_differs"]);
  });
});

describe("matchDocument (US4-1)", () => {
  const doc = (o: Partial<MatchDocument> = {}): MatchDocument => ({
    id: "d1",
    businessKey: "exp_20261015_001",
    vendorName: "BYTEFORM AB",
    vendorVatNumber: null,
    invoiceNumber: null,
    date: "2026-10-15",
    total: "199.00",
    currency: "SEK",
    ...o,
  });
  it("the vendor's VAT number → certain, whatever the name", () => {
    expect(
      matchDocument(
        sekPeriod,
        sub,
        doc({ vendorName: "Somebody", vendorVatNumber: "SE 5560 0000 0101" }),
        noRate,
      ),
    ).toMatchObject({ certain: true, amountUnknown: false, diffPct: "0.00" });
  });
  it("the name (or the match text) without a VAT number → a match, not certain; another vendor → none", () => {
    expect(matchDocument(sekPeriod, sub, doc({ vendorName: "Byteform AB" }), noRate)?.certain).toBe(
      false,
    );
    expect(
      matchDocument(sekPeriod, { ...sub, partnerName: "Other" }, doc(), noRate),
    ).not.toBeNull(); // match text
    expect(matchDocument(sekPeriod, sub, doc({ vendorName: "Tabula GmbH" }), noRate)).toBeNull();
  });
  it("the receipt window ±10 days; no date → never", () => {
    expect(matchDocument(sekPeriod, sub, doc({ date: "2026-10-05" }), noRate)).not.toBeNull();
    expect(matchDocument(sekPeriod, sub, doc({ date: "2026-10-26" }), noRate)).toBeNull();
    expect(matchDocument(sekPeriod, sub, doc({ date: null }), noRate)).toBeNull();
  });
  it("the amount: outside the tolerance → none; no currency read, or no rate → kept, amount unknown", () => {
    expect(matchDocument(sekPeriod, sub, doc({ total: "250.00" }), noRate)).toBeNull();
    expect(matchDocument(sekPeriod, sub, doc({ currency: null }), noRate)?.amountUnknown).toBe(
      true,
    );
    expect(
      matchDocument(
        eurPeriod,
        sub,
        doc({ date: "2026-10-14", currency: "CHF", total: "20.00" }),
        noRate,
      )?.amountUnknown,
    ).toBe(true);
    expect(
      matchDocument(
        eurPeriod,
        sub,
        doc({ date: "2026-10-14", currency: "EUR", total: "22.00" }),
        noRate,
      )?.diffPct,
    ).toBe("0.00");
  });
});

describe("markAmbiguity (US3-7)", () => {
  const offer = (rowId: string): Omit<RowMatch, "ambiguous"> => ({
    rowId,
    bookingDate: "2026-10-16",
    amount: "199.00",
    currency: "SEK",
    description: "",
    diffPct: "0.00",
    crossCurrency: false,
    byText: true,
    exact: true,
    hints: [],
  });
  it("one row for two periods → ambiguous on both; two rows for one period → both ambiguous; alone → not", () => {
    const m = markAmbiguity<RowMatch>([
      { periodKey: "A|2026-10-15", itemId: "r1", offer: offer("r1") },
      { periodKey: "B|2026-10-15", itemId: "r1", offer: offer("r1") },
      { periodKey: "C|2026-10-15", itemId: "r2", offer: offer("r2") },
      { periodKey: "C|2026-10-15", itemId: "r3", offer: offer("r3") },
      { periodKey: "D|2026-10-15", itemId: "r4", offer: offer("r4") },
    ]);
    expect(m.get("A|2026-10-15")?.[0]?.ambiguous).toBe(true);
    expect(m.get("B|2026-10-15")?.[0]?.ambiguous).toBe(true);
    expect(m.get("C|2026-10-15")?.map((o) => o.ambiguous)).toEqual([true, true]);
    expect(m.get("D|2026-10-15")?.[0]?.ambiguous).toBe(false);
  });
});
