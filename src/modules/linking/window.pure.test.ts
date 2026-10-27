// The payment window and the date claim (F116 FR-001 / FR-002, specs/linking/one-engine.md): an invoice on terms is
// paid by its due date, not within five days of its issue.
import { describe, expect, it } from "vitest";
import { dateClaim, nameTokens, referenceTokens, scoreMatch } from "./scoring";
import type { EntityFacts } from "./types";
import { inWindow, paymentWindow, termsSpan } from "./window";

const invoice = (over: Partial<EntityFacts> = {}): EntityFacts => ({
  type: "invoice",
  id: "i1",
  label: "VA26-003",
  amount: "24000.00",
  currency: "CHF",
  amountBase: "258000.00",
  date: "2026-06-30",
  dueDate: "2026-07-30",
  reference: "VA26-003",
  partnerName: "Byteform AG",
  partnerId: "p-byteform",
  texts: [],
  direction: "incoming",
  remaining: "24000.00",
  ...over,
});

describe("paymentWindow", () => {
  it("an entity with terms: from five days before the issue to ten after the due date — at least 60 days", () => {
    expect(paymentWindow(invoice())).toEqual({ from: "2026-06-25", to: "2026-08-29" });
    // due the same day (a card-paid SaaS invoice): still 60 days
    expect(paymentWindow(invoice({ dueDate: "2026-06-30" }))).toEqual({
      from: "2026-06-25",
      to: "2026-08-29",
    });
    // 90-day terms: the due date + 10
    expect(paymentWindow(invoice({ dueDate: "2026-09-28" })).to).toBe("2026-10-08");
    // no due date: 60 days
    expect(paymentWindow(invoice({ dueDate: null })).to).toBe("2026-08-29");
  });

  it("an entity dated once: ± ten days", () => {
    expect(paymentWindow({ type: "expense", date: "2026-07-10" })).toEqual({
      from: "2026-06-30",
      to: "2026-07-20",
    });
    expect(inWindow("2026-07-21", { type: "document", date: "2026-07-10" })).toBe(false);
  });

  it("termsSpan is the mirror: a row booked in the span can pay what it selects", () => {
    expect(termsSpan({ bookedFrom: "2026-07-30", bookedTo: "2026-07-30" })).toEqual({
      issuedTo: "2026-08-04",
      dueFrom: "2026-07-20",
      issuedFrom: "2026-05-31",
    });
    expect(termsSpan({})).toBeNull();
  });
});

describe("dateClaim", () => {
  it("same day, two days, on the due date, within the terms, late — and nothing outside the window", () => {
    expect(dateClaim("2026-06-30", invoice())).toEqual({ points: 30, reason: "Same date" });
    expect(dateClaim("2026-07-02", invoice())).toEqual({ points: 25, reason: "Within 2 days" });
    expect(dateClaim("2026-07-30", invoice())).toEqual({
      points: 30,
      reason: "Paid on the due date",
    });
    expect(dateClaim("2026-07-15", invoice())).toEqual({ points: 15, reason: "Within the terms" });
    expect(dateClaim("2026-08-03", invoice())).toEqual({
      points: 15,
      reason: "4 days after the due date",
    });
    expect(dateClaim("2026-08-08", invoice())).toEqual({
      points: 5,
      reason: "9 days after the due date",
    });
    expect(dateClaim("2026-09-15", invoice())).toBeNull();
    expect(dateClaim("2026-06-20", invoice())).toBeNull();
  });
});

describe("names, numbers, memory (F116 FR-003 / FR-004)", () => {
  it("name tokens skip legal forms and trade words", () => {
    expect(nameTokens("Skattepunkten's Office Services AB")).toEqual(["skattepunkten"]);
    expect(nameTokens("Anthropic PBC")).toEqual(["anthropic"]);
    expect(nameTokens("Byteform AG")).toEqual(["byteform"]);
  });

  it("reference tokens keep what could be a number", () => {
    expect(referenceTokens(["BYTEFORM AG VA26-003", null, "Kortköp 260727 OPENAI"])).toEqual(
      expect.arrayContaining(["VA26-003", "260727"]),
    );
    expect(referenceTokens(["OPENAI *CHATGPT"])).toEqual([]);
  });

  const row = (over: { amount?: string; date?: string; texts?: string[] } = {}) => ({
    amount: over.amount ?? "24000.00",
    currency: "CHF",
    amountBase: "258000.00",
    date: over.date ?? "2026-07-30",
    texts: over.texts ?? ["BYTEFORM AG", "VA26-003"],
  });

  it("case 1 — the invoice paid on its terms: number, client token, exact amount, the due date → HIGH 135", () => {
    const m = scoreMatch(row(), invoice());
    expect(m).toMatchObject({ score: 135, confidence: "HIGH", reference: true });
    expect(m?.reasons).toEqual([
      "Invoice number in message",
      "Client name match",
      "Exact amount match",
      "Paid on the due date",
    ]);
  });

  it("case 2 — a truncated name is found by its token", () => {
    const si = invoice({
      type: "supplier_invoice",
      partnerName: "Anthropic PBC",
      reference: "INV-77",
      amount: "2312.43",
      currency: "SEK",
      amountBase: "2312.43",
      date: "2026-07-27",
      dueDate: "2026-08-26",
      direction: "outgoing",
    });
    const m = scoreMatch(
      {
        amount: "2312.43",
        currency: "SEK",
        amountBase: "2312.43",
        date: "2026-07-28",
        texts: ["ANTHROPIC* CLAU 1234"],
      },
      si,
    );
    expect(m?.reasons).toEqual(["Supplier name match", "Exact amount match", "Within 2 days"]);
    expect(m?.confidence).toBe("HIGH");
    // Nordea's cut: SKATTEPUNK finds Skattepunkten
    expect(
      scoreMatch(
        {
          ...row(),
          currency: "SEK",
          amountBase: "9160.00",
          amount: "9160.00",
          texts: ["SKATTEPUNK"],
        },
        {
          ...si,
          partnerName: "Skattepunkten's Office Services AB",
          amount: "9160.00",
          amountBase: "9160.00",
        },
      )?.reasons,
    ).toContain("Supplier name match");
  });

  it("case 3 — the memory: linked to the partner before is 25 points and a reference", () => {
    const memory = new Map([["p-byteform", { name: "Byteform AG", count: 39 }]]);
    const plain = scoreMatch(row({ texts: ["XYZ PAYMENT"] }), invoice());
    const remembered = scoreMatch(row({ texts: ["XYZ PAYMENT"] }), invoice(), memory);
    expect((remembered?.score ?? 0) - (plain?.score ?? 0)).toBe(25);
    expect(remembered?.reasons).toContain("Linked to Byteform AG 39 times before");
    expect(remembered?.reference).toBe(true);
    expect(remembered?.confidence).toBe("HIGH");
    expect(
      scoreMatch(row(), invoice(), new Map([["p-byteform", { name: "Byteform AG", count: 1 }]]))
        ?.reasons,
    ).toContain("Linked to Byteform AG once before");
  });

  it("case 4 — nothing true beyond the date: no suggestion", () => {
    const si = invoice({
      type: "supplier_invoice",
      partnerName: "Skattepunkten AB",
      reference: "9160",
      amount: "9160.00",
      currency: "SEK",
      amountBase: "9160.00",
      date: "2026-07-20",
      dueDate: "2026-08-19",
      direction: "outgoing",
    });
    expect(
      scoreMatch(
        {
          amount: "1324.00",
          currency: "SEK",
          amountBase: "1324.00",
          date: "2026-07-24",
          texts: ["SKATTEVERKET"],
        },
        si,
      ),
    ).toBeNull();
  });

  it("an amount 9 % off is still a (weak) claim; 11 % off is none", () => {
    const at = (amount: string) =>
      scoreMatch(row({ amount, texts: ["SOMEONE"], date: "2026-07-01" }), invoice())?.reasons ?? [];
    expect(at("21900.00")).toContain("Approximate amount match");
    expect(at("21300.00")).toEqual([]);
  });
});
