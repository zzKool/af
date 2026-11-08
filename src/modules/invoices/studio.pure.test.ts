import { describe, expect, it } from "vitest";
import { translator } from "@/kernel/i18n/translate";
import { expectedPayment, type PaidInvoice, paymentStats } from "./payment-history";
import { type ReadyFacts, readyToSend } from "./ready";
import { reminderDraft, reminderDue } from "./reminder";

// Invented facts (D51): a Swiss client invoiced in CHF from the CH registration.
const facts = (over: Partial<ReadyFacts> = {}): ReadyFacts => ({
  type: "invoice",
  partnerShortCode: "IC",
  lines: [{ description: "Data consulting", quantity: "19", unitPrice: "1200" }],
  periodLabel: "July 2026",
  references: [{ label: "PO", value: "4500000001" }],
  registration: { country: "CH" },
  treatment: "standard",
  vatRates: ["8.1"],
  currency: "CHF",
  bank: { currency: "CHF", iban: "CH00 0000 0000 0000 0000 0" },
  rateKnown: true,
  ...over,
});

describe("readyToSend (F143)", () => {
  it("everything there: every line ok, ready", () => {
    const r = readyToSend(facts());
    expect(r.items.map((i) => `${i.key}:${i.state}`)).toEqual([
      "client:ok",
      "lines:ok",
      "period:ok",
      "references:ok",
      "vat:ok",
      "bank:ok",
      "rate:ok",
    ]);
    expect(r).toMatchObject({ ok: 7, ready: true });
    expect(r.items.find((i) => i.key === "vat")?.params).toMatchObject({
      country: "CH",
      rate: "8.1 %",
    });
  });

  it("an empty PO, no ECB rate yet, a line without a price: not ready, each says why", () => {
    const r = readyToSend(
      facts({
        references: [{ label: "PO", value: " " }],
        rateKnown: false,
        lines: [{ description: "Data consulting", quantity: "19", unitPrice: "0" }],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.items.filter((i) => i.state === "todo").map((i) => i.key)).toEqual([
      "lines",
      "references",
      "rate",
    ]);
    expect(r.items.find((i) => i.key === "references")?.params?.list).toBe("PO");
  });

  it("paid into another currency's account: a warning, still ready; no account: not ready", () => {
    expect(
      readyToSend(facts({ bank: { currency: "SEK", iban: "SE00" } })).items.find(
        (i) => i.key === "bank",
      )?.state,
    ).toBe("warn");
    expect(readyToSend(facts({ bank: null })).ready).toBe(false);
  });

  it("a quote has no period line; no references, no references line", () => {
    const keys = readyToSend(facts({ type: "quote", references: [] })).items.map((i) => i.key);
    expect(keys).not.toContain("period");
    expect(keys).not.toContain("references");
  });
});

describe("payment history (F143)", () => {
  const paid = (days: number, late = false): PaidInvoice => ({
    id: String(days),
    number: null,
    issueDate: "2026-01-01",
    dueDate: "2026-01-31",
    paidOn: "2026-02-01",
    days,
    late,
  });

  it("the spread and the average; the expected window from a send day", () => {
    const s = paymentStats([paid(21), paid(27), paid(24, true)]);
    expect(s).toEqual({ count: 3, minDays: 21, maxDays: 27, avgDays: 24, lateCount: 1 });
    expect(expectedPayment(s, "2026-08-01")).toEqual({ from: "2026-08-22", to: "2026-08-28" });
  });

  it("no history: nothing to say", () => {
    expect(paymentStats([])).toBeNull();
    expect(expectedPayment(null, "2026-08-01")).toBeNull();
  });
});

describe("the reminder (F143)", () => {
  it("offered from three days after the due date, while something is open", () => {
    expect(reminderDue("2026-07-31", "2026-08-02", true)).toBe(false);
    expect(reminderDue("2026-07-31", "2026-08-03", true)).toBe(true);
    expect(reminderDue("2026-07-31", "2026-08-10", false)).toBe(false);
  });

  it("in the document's language, with the number, the dates and what is open", () => {
    const f = {
      number: "IC26-INV-008",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      open: "CHF 9'600.00",
      clientName: "Invented Client SA",
      companyName: "Invented AB",
      ownerName: "Alex",
    };
    const fr = reminderDraft(f, "2026-08-08", translator("fr"));
    expect(fr.subject).toBe("Rappel de paiement — facture IC26-INV-008");
    expect(fr.body).toContain("CHF 9'600.00 reste ouvert");
    expect(fr.daysLate).toBe(8);
    expect(reminderDraft(f, "2026-08-08", translator("en")).body).toContain(
      "Dear Invented Client SA,",
    );
  });
});
