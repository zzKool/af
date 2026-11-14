// The consistency checks of a proof (F130, review 2026-10-31 §4): every check green and red, the FX boundaries of
// O4 (4 % on a card row, the scorer's 6 % elsewhere), one full example each way, and the sentences in English.
// Invented values (D51).
import { describe, expect, it } from "vitest";
import { translator } from "@/kernel/i18n/translate";
import { formatMoney } from "@/kernel/money/format-money";
import { type CheckProofInput, checkProof, warningMessage } from "./check-proof";
import type { Reading, RowForJustify } from "./justify-rules";
import type { ProofWarning } from "./types";

type Row = CheckProofInput["row"];

/** The Skattepunkten row of the review's example: a transfer, SEK. */
const transferRow = (over: Partial<Row> = {}): Row => ({
  bookingDate: "2026-07-08",
  amount: "-1297.20",
  currency: "SEK",
  amountBase: "-1297.20",
  description: "SKATTEPUNKTEN OFFICE",
  counterpartyKey: "SKATTEPUNKTEN OFFICE",
  ...over,
});

/** A card purchase abroad: the key stripped of its reference (F124 (6)), the bank's SEK. */
const cardRow = (over: Partial<Row> = {}): Row => ({
  bookingDate: "2026-07-09",
  amount: "-143.50",
  currency: "SEK",
  amountBase: "-143.50",
  description: "Kortköp 260708 MSFT *E0100ZW7M8",
  counterpartyKey: "MSFT",
  ...over,
});

const skattepunkten: Reading = {
  vendorName: "Skattepunkten Office Services AB",
  vendorTaxId: "SE556677889901",
  invoiceNumber: "2026-071",
  invoiceDate: "2026-07-06",
  dueDate: "2026-08-05",
  invoiceTotal: 1297.2,
  currency: "SEK",
  customerName: "Dev AB",
};

const microsoft: Reading = {
  vendorName: "Microsoft Ireland Operations Ltd",
  vendorTaxId: "IE8256796U",
  invoiceNumber: "E0100ZW7M8",
  invoiceDate: "2026-07-08",
  invoiceTotal: 12,
  currency: "EUR",
  customerName: "Dev AB",
};

const partnerMicrosoft = { id: "p-msft", name: "Microsoft AB", vatNumber: "SE556703xxxx01" };

const input = (over: Partial<CheckProofInput> = {}): CheckProofInput => ({
  row: transferRow(),
  reading: skattepunkten,
  partner: null,
  memory: [],
  rulePartnerIds: [],
  fxRate: null,
  billedToFits: true,
  companyName: "Dev AB",
  documentJustifiesOther: null,
  supplierNumberTaken: false,
  ...over,
});

const codes = (ws: ProofWarning[]) => ws.map((w) => w.code);
const only = <C extends ProofWarning["code"]>(ws: ProofWarning[], code: C) =>
  ws.find((w): w is Extract<ProofWarning, { code: C }> => w.code === code);

describe("checkProof — vendor ↔ counterparty", () => {
  it("green when a token of the vendor's name is in the row's text (Nordea's truncation included)", () => {
    expect(checkProof(input())).toEqual([]);
    expect(
      codes(
        checkProof(input({ row: transferRow({ description: "SKATTEPUNK", counterpartyKey: "" }) })),
      ),
    ).not.toContain("vendor_counterparty");
  });

  it("MSFT never matches Microsoft (four letters, no common prefix): the paper, the bank and the key named", () => {
    const ws = checkProof(
      input({ row: cardRow(), reading: microsoft, partner: partnerMicrosoft, fxRate: "11.42" }),
    );
    expect(only(ws, "vendor_counterparty")?.facts).toEqual({
      vendorName: "Microsoft Ireland Operations Ltd",
      counterpartyKey: "MSFT",
    });
  });

  it("green when the paper's VAT number is the partner's, however it is written", () => {
    const ws = checkProof(
      input({
        row: cardRow(),
        reading: microsoft,
        partner: { ...partnerMicrosoft, vatNumber: "ie 8256796-u" },
        fxRate: "11.42",
      }),
    );
    expect(codes(ws)).not.toContain("vendor_counterparty");
  });

  it("green when the key was linked to the partner before (the memory) or a rule for the key names it (D74)", () => {
    const base = { row: cardRow(), reading: microsoft, partner: partnerMicrosoft, fxRate: "11.42" };
    expect(
      codes(
        checkProof(input({ ...base, memory: [{ partnerId: "p-other" }, { partnerId: "p-msft" }] })),
      ),
    ).not.toContain("vendor_counterparty");
    expect(codes(checkProof(input({ ...base, rulePartnerIds: ["p-msft"] })))).not.toContain(
      "vendor_counterparty",
    );
    // another partner's memory or rule says nothing about this one
    expect(
      codes(
        checkProof(input({ ...base, memory: [{ partnerId: "p-other" }], rulePartnerIds: ["p-x"] })),
      ),
    ).toContain("vendor_counterparty");
  });

  it("green when the partner's own name hits the row text, even if the paper's vendor name does not", () => {
    const ws = checkProof(
      input({
        row: transferRow({ description: "SKATTEPUNKTEN OFFICE" }),
        reading: { ...skattepunkten, vendorName: "SPOS Billing Services" },
        partner: { id: "p-skp", name: "Skattepunkten Office Services AB", vatNumber: null },
      }),
    );
    expect(codes(ws)).not.toContain("vendor_counterparty");
  });

  it("silent when the paper names no vendor and no partner is picked — nothing to compare", () => {
    const ws = checkProof(input({ reading: { invoiceTotal: 1297.2, currency: "SEK" } }));
    expect(codes(ws)).not.toContain("vendor_counterparty");
  });
});

describe("checkProof — the amount across currencies (O4: 4 % on a card row, 6 % elsewhere)", () => {
  // EUR 10.00 at 10 = 100.00 SEK: the row's amount is the percentage
  const eur10: Reading = { ...microsoft, invoiceTotal: 10, currency: "EUR" };
  const at = (row: Row) =>
    only(checkProof(input({ row, reading: eur10, fxRate: "10" })), "amount_fx");

  it("a card row: 3.9 % and 4.0 % green, 4.1 % warns with both amounts, the rate and the share", () => {
    expect(at(cardRow({ amount: "-103.90", amountBase: "-103.90" }))).toBeUndefined();
    expect(at(cardRow({ amount: "-104.00", amountBase: "-104.00" }))).toBeUndefined();
    expect(at(cardRow({ amount: "-104.10", amountBase: "-104.10" }))?.facts).toEqual({
      readingAmount: "10.00",
      readingCurrency: "EUR",
      rowAmount: "104.10",
      rowCurrency: "SEK",
      bookingDate: "2026-07-09",
      rate: "10",
      converted: "100.00",
      offPct: "4.1",
      tolerancePct: "4",
      kind: "card",
    });
  });

  it("a transfer: 5.9 % green, 6.1 % warns — the scorer's figure, unchanged", () => {
    expect(at(transferRow({ amount: "-105.90", amountBase: "-105.90" }))).toBeUndefined();
    const w = at(transferRow({ amount: "-106.10", amountBase: "-106.10" }));
    expect(w?.facts).toMatchObject({ offPct: "6.1", tolerancePct: "6", kind: "other" });
  });

  it("the share is judged exactly, not on the printed decimal; the bank taking less counts the same way", () => {
    // 4.04 % prints as 4.0 and is still beyond 4 %
    expect(at(cardRow({ amount: "-104.04", amountBase: "-104.04" }))?.facts.offPct).toBe("4.0");
    expect(at(cardRow({ amount: "-95.00", amountBase: "-95.00" }))?.facts.offPct).toBe("-5.0");
  });

  it("no rate stored for the booking date: said, not compared", () => {
    const w = only(
      checkProof(input({ row: cardRow(), reading: microsoft, fxRate: null })),
      "amount_fx",
    );
    expect(w?.facts).toMatchObject({
      readingAmount: "12.00",
      readingCurrency: "EUR",
      rowAmount: "143.50",
      rate: null,
      converted: null,
      offPct: null,
      kind: "card",
    });
  });

  it("the review's example: EUR 12.00 at 11.42 = 137.04, the bank took 143.50 (+4.7 %) on a card", () => {
    const w = only(
      checkProof(input({ row: cardRow(), reading: microsoft, fxRate: "11.420000" })),
      "amount_fx",
    );
    expect(w?.facts).toMatchObject({ rate: "11.42", converted: "137.04", offPct: "4.7" });
  });
});

describe("checkProof — the amount, same currency (the settlement tolerance, D25, both ways)", () => {
  it("equal, or within max(0.05, 0.5 %): green", () => {
    expect(codes(checkProof(input()))).not.toContain("amount_same");
    // 1 300.00 on the paper, 1 297.20 taken: 2.80 within 6.50
    expect(
      codes(checkProof(input({ reading: { ...skattepunkten, invoiceTotal: 1300 } }))),
    ).not.toContain("amount_same");
  });

  it("off by more: the difference is named, signed as the bank against the paper", () => {
    const more = only(
      checkProof(input({ reading: { ...skattepunkten, invoiceTotal: 1290 } })),
      "amount_same",
    );
    expect(more?.facts).toEqual({
      readingAmount: "1290.00",
      rowAmount: "1297.20",
      currency: "SEK",
      difference: "7.20",
    });
    const less = only(
      checkProof(
        input({
          row: transferRow({ amount: "-1283.00", amountBase: "-1283.00" }),
          reading: { ...skattepunkten, invoiceTotal: 1290 },
        }),
      ),
      "amount_same",
    );
    expect(less?.facts.difference).toBe("-7.00");
  });

  it("the paper's currency is read case-insensitively", () => {
    expect(codes(checkProof(input({ reading: { ...skattepunkten, currency: "sek" } })))).toEqual(
      [],
    );
  });
});

describe("checkProof — the date", () => {
  const paper: Reading = { ...microsoft, invoiceDate: "2026-07-08" };
  const card = (bookingDate: string) =>
    only(
      checkProof(input({ row: cardRow({ bookingDate }), reading: paper, fxRate: "11.95" })),
      "date",
    );

  it("a card row 0–5 days after the paper is green; before, or later, says the days", () => {
    expect(card("2026-07-08")).toBeUndefined();
    expect(card("2026-07-13")).toBeUndefined();
    expect(card("2026-07-14")?.facts).toEqual({
      days: 6,
      when: "after",
      anchor: "paper",
      anchorDate: "2026-07-08",
      bookingDate: "2026-07-14",
    });
    expect(card("2026-07-07")?.facts).toMatchObject({ days: 1, when: "before", anchor: "paper" });
  });

  const invoice = (bookingDate: string, reading: Reading = skattepunkten) =>
    only(checkProof(input({ row: transferRow({ bookingDate }), reading })), "date");

  it("an invoice paid inside its window (issue − 5 … max(due + 10, issue + 60)) is green; outside, the days from the due date", () => {
    expect(invoice("2026-07-08")).toBeUndefined();
    expect(invoice("2026-07-01")).toBeUndefined();
    expect(invoice("2026-08-16")).toBeUndefined(); // past due + 10, still inside issue + 60 (window.ts)
    expect(invoice("2026-09-04")).toBeUndefined();
    expect(invoice("2026-09-05")?.facts).toEqual({
      days: 31,
      when: "after",
      anchor: "due",
      anchorDate: "2026-08-05",
      bookingDate: "2026-09-05",
    });
    expect(invoice("2026-06-30")?.facts).toMatchObject({
      days: 6,
      when: "before",
      anchor: "invoice",
      anchorDate: "2026-07-06",
    });
  });

  it("without a due date the window runs 60 days from the invoice date, and the late count is from it", () => {
    const noDue: Reading = { ...skattepunkten, dueDate: undefined };
    expect(invoice("2026-09-04", noDue)).toBeUndefined();
    expect(invoice("2026-09-05", noDue)?.facts).toMatchObject({
      days: 61,
      when: "after",
      anchor: "invoice",
      anchorDate: "2026-07-06",
    });
  });

  it("no date read: nothing to compare", () => {
    const ws = checkProof(
      input({ reading: { ...skattepunkten, invoiceDate: undefined, dueDate: undefined } }),
    );
    expect(codes(ws)).not.toContain("date");
  });
});

describe("checkProof — billed to, already a proof, the currency not read", () => {
  it("billed to: the caller's verdict (D53) — false warns with the names, null is silent", () => {
    expect(only(checkProof(input({ billedToFits: false })), "billed_to")?.facts).toEqual({
      companyName: "Dev AB",
      billedTo: "Dev AB",
    });
    expect(
      only(
        checkProof(
          input({
            billedToFits: false,
            reading: { ...skattepunkten, customerName: "Someone Else AB" },
          }),
        ),
        "billed_to",
      )?.facts.billedTo,
    ).toBe("Someone Else AB");
    expect(
      only(
        checkProof(
          input({ billedToFits: false, reading: { ...skattepunkten, customerName: undefined } }),
        ),
        "billed_to",
      )?.facts.billedTo,
    ).toBeNull();
    expect(codes(checkProof(input({ billedToFits: null })))).not.toContain("billed_to");
  });

  it("already a proof: the other row's date, the supplier's number (D35), or both — one warning", () => {
    expect(
      only(
        checkProof(input({ documentJustifiesOther: { rowDate: "2026-06-08" } })),
        "already_proof",
      )?.facts,
    ).toEqual({ rowDate: "2026-06-08", invoiceNumber: null });
    expect(only(checkProof(input({ supplierNumberTaken: true })), "already_proof")?.facts).toEqual({
      rowDate: null,
      invoiceNumber: "2026-071",
    });
    const both = checkProof(
      input({ documentJustifiesOther: { rowDate: "2026-06-08" }, supplierNumberTaken: true }),
    );
    expect(both.filter((w) => w.code === "already_proof")).toHaveLength(1);
    expect(only(both, "already_proof")?.facts).toEqual({
      rowDate: "2026-06-08",
      invoiceNumber: "2026-071",
    });
  });

  it("an amount read without a currency (F61-b): said once, and no amount check runs", () => {
    const ws = checkProof(
      input({
        row: cardRow({
          amount: "-523.17",
          amountBase: "-523.17",
          description: "Kortköp SBB CFF FFS",
          counterpartyKey: "SBB CFF FFS",
        }),
        reading: { merchantName: "SBB CFF FFS", invoiceTotal: 45, transactionDate: "2026-07-08" },
        fxRate: "11.6",
      }),
    );
    expect(codes(ws)).toEqual(["currency_unread"]);
    expect(only(ws, "currency_unread")?.facts).toEqual({
      readingAmount: "45.00",
      rowAmount: "523.17",
      rowCurrency: "SEK",
    });
  });

  it("nothing read at all (the OCR failed, the receipt lost): nothing to say", () => {
    expect(checkProof(input({ reading: {} }))).toEqual([]);
  });
});

describe("checkProof — one full example each way", () => {
  it("the Skattepunkten invoice on its row: every check green", () => {
    expect(
      checkProof(
        input({
          partner: {
            id: "p-skp",
            name: "Skattepunkten Office Services AB",
            vatNumber: "SE556677889901",
          },
        }),
      ),
    ).toEqual([]);
  });

  it("a Microsoft bill on an MSFT card row, booked late, billed to someone else: the warnings in the table's order", () => {
    const ws = checkProof(
      input({
        row: cardRow({ bookingDate: "2026-07-20" }),
        reading: { ...microsoft, customerName: "Someone Else AB" },
        partner: partnerMicrosoft,
        fxRate: "11.42",
        billedToFits: false,
        supplierNumberTaken: true,
      }),
    );
    expect(codes(ws)).toEqual([
      "vendor_counterparty",
      "amount_fx",
      "date",
      "billed_to",
      "already_proof",
    ]);
  });
});

describe("warningMessage — the English sentences, the facts in them", () => {
  const t = translator("en");
  const row: RowForJustify = {
    ...cardRow(),
    id: "r1",
    bankAccountId: "acc",
    accountLabel: "Plusgirokonto SEK",
  };
  const text = (over: Partial<CheckProofInput>) =>
    checkProof(input({ row, reading: microsoft, fxRate: "11.42", ...over })).map((w) =>
      warningMessage(w, t),
    );

  it("vendor, FX amount and date on the card row", () => {
    expect(text({ row: { ...row, bookingDate: "2026-07-20" }, partner: partnerMicrosoft })).toEqual(
      [
        "The paper names Microsoft Ireland Operations Ltd, the bank says MSFT — the same supplier?",
        `${formatMoney("12.00", "EUR")} at 11.42 = ${formatMoney("137.04", "SEK")}; the bank took ${formatMoney("143.50", "SEK")} (+4.7 %) — more than the 4 % margin of a card purchase`,
        "Booked 12 days after the paper's date (2026-07-08)",
      ],
    );
  });

  it("no rate, the same currency off, early, billed to, already a proof, no currency — each one line", () => {
    expect(
      text({ fxRate: null, partner: partnerMicrosoft, memory: [{ partnerId: "p-msft" }] }),
    ).toEqual([
      `No ECB rate for 2026-07-09 — ${formatMoney("12.00", "EUR")} is not compared with ${formatMoney("143.50", "SEK")}`,
    ]);
    const same = checkProof(input({ reading: { ...skattepunkten, invoiceTotal: 1290 } }));
    expect(same.map((w) => warningMessage(w, t))).toEqual([
      `Off by ${formatMoney("7.20", "SEK", { signed: true })} — the paper shows ${formatMoney("1290.00", "SEK")}, the bank took ${formatMoney("1297.20", "SEK")}`,
    ]);
    const early = checkProof(input({ row: transferRow({ bookingDate: "2026-06-30" }) }));
    expect(early.map((w) => warningMessage(w, t))).toEqual([
      "Booked 6 days before the invoice date (2026-07-06)",
    ]);
    const other = checkProof(
      input({
        reading: { ...skattepunkten, customerName: "Someone Else AB" },
        billedToFits: false,
        documentJustifiesOther: { rowDate: "2026-06-08" },
        supplierNumberTaken: true,
      }),
    );
    expect(other.map((w) => warningMessage(w, t))).toEqual([
      "Billed to Someone Else AB, not to Dev AB",
      "This document already justifies the row of 2026-06-08, and invoice number 2026-071 exists already",
    ]);
    expect(
      warningMessage({ code: "billed_to", facts: { companyName: "Dev AB", billedTo: null } }, t),
    ).toBe("Not addressed to Dev AB");
    expect(
      warningMessage(
        { code: "already_proof", facts: { rowDate: null, invoiceNumber: "2026-071" } },
        t,
      ),
    ).toBe("Invoice number 2026-071 exists already for this supplier — a second one is refused");
    expect(
      warningMessage(
        {
          code: "currency_unread",
          facts: { readingAmount: "45.00", rowAmount: "523.17", rowCurrency: "SEK" },
        },
        t,
      ),
    ).toBe(`No currency read — 45.00 is not compared with ${formatMoney("523.17", "SEK")}`);
  });

  it("the bank taking less prints the kit's minus; a transfer names its 6 %", () => {
    const less = checkProof(
      input({
        row: transferRow({ amount: "-120.00", amountBase: "-120.00", bookingDate: "2026-07-09" }),
        reading: { ...microsoft, vendorName: "Skattepunkten Office Services AB" },
        fxRate: "11.42",
      }),
    );
    expect(less.map((w) => warningMessage(w, t))).toEqual([
      `${formatMoney("12.00", "EUR")} at 11.42 = ${formatMoney("137.04", "SEK")}; the bank took ${formatMoney("120.00", "SEK")} (−12.4 %) — more than the 6 % margin of a transfer`,
    ]);
  });
});
