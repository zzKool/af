// Transfer-pair detection (specs/banking US3, harvest §4.7): the owner's CHANGE CHFSEK pair, savings moves,
// the thresholds.

import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import { type TransferLeg, transferCandidates } from "./transfer-pairs";

const D = Prisma.Decimal;
/** SEK per unit on the legs' date, by foreign currency */
const CHF_RATE = new Map([["CHF", new D("11.90")]]);
const NO_RATES = new Map<string, InstanceType<typeof D>>();

const chf: TransferLeg = {
  id: "chf",
  bankAccountId: "acc-chf",
  accountNumber: "123 45 67-8",
  accountLabel: "Plusgirokonto CHF",
  bookingDate: "2026-07-08",
  amount: "-20000.00",
  currency: "CHF",
  text: "123 45 67-8 CHANGE CHFSEK 999999-5 CHANGE CHFSEK",
};
const sek: TransferLeg = {
  id: "sek",
  bankAccountId: "acc-sek",
  accountNumber: "123 45 67-8",
  accountLabel: "Plusgirokonto SEK",
  bookingDate: "2026-07-08",
  amount: "237740.00",
  currency: "SEK",
  text: "CHANGE CHFSEK 999999-5 CHANGE CHFSEK",
};

describe("transferCandidates", () => {
  it("proposes the owner's CHANGE CHFSEK pair with implied 11.887 against ECB 11.90", () => {
    const out = transferCandidates(chf, [sek], CHF_RATE);
    expect(out).toHaveLength(1);
    expect(out[0].from.id).toBe("chf");
    expect(out[0].to.id).toBe("sek");
    expect(out[0].implied).toBe("11.887000");
    expect(out[0].ecb).toBe("11.900000");
    expect(out[0].deviationPercent).toBe("0.11");
    expect(out[0].hints).toContain("CHANGE");
    expect(out[0].confidence).toBe("high");
    // the same pair seen from the SEK side
    const back = transferCandidates(sek, [chf], CHF_RATE);
    expect(back[0].from.id).toBe("chf");
    expect(back[0].to.id).toBe("sek");
  });

  it("rejects a pair outside 5 % of the ECB rate, the same sign, the same account, or > 2 days apart", () => {
    expect(transferCandidates(chf, [sek], new Map([["CHF", new D("13.00")]]))).toHaveLength(0);
    expect(transferCandidates(chf, [{ ...sek, amount: "-237740.00" }], CHF_RATE)).toHaveLength(0);
    expect(transferCandidates(chf, [{ ...sek, bankAccountId: "acc-chf" }], CHF_RATE)).toHaveLength(
      0,
    );
    expect(transferCandidates(chf, [{ ...sek, bookingDate: "2026-07-11" }], CHF_RATE)).toHaveLength(
      0,
    );
    expect(transferCandidates(chf, [{ ...sek, bookingDate: "2026-07-10" }], CHF_RATE)).toHaveLength(
      1,
    );
    expect(transferCandidates(chf, [sek], NO_RATES)).toHaveLength(0); // no ECB rate → nothing to compare
  });

  it("a savings move pairs at rate 1 on equal amounts only", () => {
    const out: TransferLeg = {
      id: "out",
      bankAccountId: "acc-sek",
      accountNumber: "123 45 67-8",
      accountLabel: "Plusgirokonto SEK",
      bookingDate: "2025-12-31",
      amount: "-50000.00",
      currency: "SEK",
      text: "TRANSFER TO OWN ACCOUNT",
    };
    const inn: TransferLeg = {
      id: "in",
      bankAccountId: "acc-sav",
      accountNumber: "1234 56 78901",
      accountLabel: "Sparkonto",
      bookingDate: "2026-01-02",
      amount: "50000.00",
      currency: "SEK",
      text: "TRANSFER FROM OWN ACCOUNT SEK",
    };
    const res = transferCandidates(inn, [out], NO_RATES);
    expect(res).toHaveLength(1);
    expect(res[0].implied).toBe("1.000000");
    expect(res[0].ecb).toBeNull();
    expect(res[0].from.id).toBe("out");
    expect(transferCandidates(inn, [{ ...out, amount: "-49999.00" }], NO_RATES)).toHaveLength(0);
  });

  it("ranks hinted / same-day pairs first and tells medium from high", () => {
    const plain = { ...sek, id: "sek2", text: "", bookingDate: "2026-07-10", amount: "233000.00" };
    const res = transferCandidates({ ...chf, text: "" }, [plain, sek], CHF_RATE);
    expect(res.map((r) => r.to.id)).toEqual(["sek", "sek2"]);
    expect(res[1].confidence).toBe("medium");
  });

  it("compares each candidate with its own currency's ECB rate — a SEK leg, a CHF leg and a EUR leg (lessons 32)", () => {
    // 22 200 SEK out; in the same days 1 865.60 CHF (≈ 11.90) and 2 000.00 EUR (= 11.10) come in on other accounts
    const out: TransferLeg = { ...sek, id: "sek-out", amount: "-22200.00", text: "" };
    const inChf: TransferLeg = { ...chf, id: "chf-in", amount: "1865.60", text: "" };
    const inEur: TransferLeg = {
      ...chf,
      id: "eur-in",
      bankAccountId: "acc-eur",
      accountLabel: "Konto EUR",
      amount: "2000.00",
      currency: "EUR",
      text: "",
    };
    const ecb = new Map([
      ["CHF", new D("11.90")],
      ["EUR", new D("11.10")],
    ]);
    // the order of the candidates does not decide which rate a candidate is compared with
    for (const others of [
      [inChf, inEur],
      [inEur, inChf],
    ]) {
      const res = transferCandidates(out, others, ecb);
      const byTo = new Map(res.map((p) => [p.to.id, p]));
      expect([...byTo.keys()].sort()).toEqual(["chf-in", "eur-in"]);
      expect(byTo.get("chf-in")?.ecb).toBe("11.900000");
      expect(byTo.get("chf-in")?.implied).toBe("11.899657");
      expect(byTo.get("eur-in")?.ecb).toBe("11.100000");
      expect(byTo.get("eur-in")?.implied).toBe("11.100000");
      expect(byTo.get("eur-in")?.deviationPercent).toBe("0.00");
    }
    // a currency without an ECB rate proposes nothing for its candidates, the others still pair
    const chfOnly = transferCandidates(out, [inChf, inEur], CHF_RATE);
    expect(chfOnly.map((p) => p.to.id)).toEqual(["chf-in"]);
  });
});
