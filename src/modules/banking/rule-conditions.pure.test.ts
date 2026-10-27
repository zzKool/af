// Rules with conditions beyond the text (F116 PR C1, specs/linking/one-engine.md FR-007, D67).
import { describe, expect, it } from "vitest";
import { conditionMiss, firstHit, firstNearMiss, offCadence, orderRules } from "./rules";
import type { RuleText } from "./types";

const text = (over: Partial<RuleText> = {}): RuleText => ({
  counterpartyKey: "OPENAI *CHATGPT",
  name: null,
  additionalDetails: "Kortköp 260727 OPENAI *CHATGPT SUBS",
  message: null,
  sender: null,
  recipient: null,
  bankAccountId: "acc-sek",
  amount: "-132.52",
  ...over,
});
const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "OpenAI",
  matchType: "contains" as const,
  matchPattern: "OPENAI",
  matchField: "counterparty_key" as const,
  priority: 100,
  createdAt: new Date("2026-01-01"),
  bankAccountId: "acc-sek",
  sign: "out",
  expectedAmount: "132.52",
  tolerancePct: "0.5",
  ...over,
});

describe("conditionMiss", () => {
  it("holds on the account, the direction and the amount within its tolerance", () => {
    expect(conditionMiss(rule(), text())).toBeNull();
    expect(conditionMiss(rule(), text({ amount: "-133.10" }))).toBeNull(); // 0.44 % off
  });
  it("names the first condition that fails", () => {
    expect(conditionMiss(rule(), text({ bankAccountId: "acc-chf" }))).toBe("account");
    expect(conditionMiss(rule(), text({ amount: "132.52" }))).toBe("sign");
    expect(conditionMiss(rule(), text({ amount: "-199.00" }))).toBe("amount");
  });
  it("a fact the caller does not know is not checked; a rule without conditions holds everywhere", () => {
    expect(conditionMiss(rule(), text({ bankAccountId: null, amount: null }))).toBeNull();
    expect(
      conditionMiss(
        { bankAccountId: null, sign: "any", expectedAmount: null, tolerancePct: "0.5" },
        text({ amount: "5000.00" }),
      ),
    ).toBeNull();
  });
});

describe("firstHit / firstNearMiss", () => {
  const ordered = orderRules([rule(), rule({ id: "r2", name: "Fallback", matchPattern: "XYZ" })]);
  it("a text match with a failed condition is no hit — it is the near miss, with why", () => {
    expect(firstHit(ordered, text())?.id).toBe("r1");
    expect(firstNearMiss(ordered, text())).toBeNull();
    expect(firstHit(ordered, text({ amount: "-199.00" }))).toBeNull();
    expect(firstNearMiss(ordered, text({ amount: "-199.00" }))).toMatchObject({
      rule: { id: "r1" },
      reason: "amount",
    });
  });
  it("a looser rule further down still hits — then there is no near miss", () => {
    const loose = orderRules([
      rule(),
      rule({ id: "r3", priority: 10, expectedAmount: null, sign: "any", bankAccountId: null }),
    ]);
    expect(firstHit(loose, text({ amount: "-199.00" }))?.id).toBe("r3");
    expect(firstNearMiss(loose, text({ amount: "-199.00" }))).toBeNull();
  });
});

describe("offCadence", () => {
  it("monthly: a gap outside 20–40 days flags the later row; none never flags", () => {
    const rows = [
      { id: "jan", bookingDate: "2026-01-28" },
      { id: "feb", bookingDate: "2026-02-27" },
      { id: "may", bookingDate: "2026-05-28" },
      { id: "may2", bookingDate: "2026-05-30" },
    ];
    expect(offCadence("monthly", rows)).toEqual(["may", "may2"]);
    expect(offCadence("none", rows)).toEqual([]);
    expect(
      offCadence("yearly", [rows[0] as never, { id: "y", bookingDate: "2027-01-29" }]),
    ).toEqual([]);
  });
});
