import { describe, expect, it } from "vitest";
import { translator } from "@/kernel/i18n/translate";
import { rateErrorText } from "./rate-error";

// T023: a used rate's refused edit (F63 — `details.usedOn`) reads in the user's language, and never as the
// delete refusal (`details.n`).
describe("rateErrorText", () => {
  const en = translator("en");
  const violation = (details?: Record<string, string | number>) => ({
    code: "BUSINESS_RULE_VIOLATION" as const,
    message: "the service's English",
    retryable: false,
    details,
  });

  it("a used rate's start or amount edit → usedLocked, with the count", () => {
    const text = rateErrorText(violation({ usedOn: 3, fields: "rate" }), en);
    expect(text).toBe(en("contracts.rates.error.usedLocked", { n: 3 }));
    expect(text).toContain("3");
    expect(text).not.toBe(en("contracts.rates.error.inUse", { n: 3 }));
  });

  it("in French and Swedish too — not the service's English", () => {
    for (const lang of ["fr", "sv"]) {
      const t = translator(lang);
      const text = rateErrorText(violation({ usedOn: 2, fields: "validFrom" }), t);
      expect(text).toBe(t("contracts.rates.error.usedLocked", { n: 2 }));
      expect(text).not.toBe(en("contracts.rates.error.usedLocked", { n: 2 }));
      expect(text).not.toBe("the service's English");
    }
  });

  it("the delete refusal and the overlap keep their own texts", () => {
    expect(rateErrorText(violation({ n: 1 }), en)).toBe(
      en("contracts.rates.error.inUse", { n: 1 }),
    );
    expect(rateErrorText(violation({ from: "2025-01-01", to: "open" }), en)).toBe(
      en("contracts.rates.error.overlap", { from: "2025-01-01", to: en("contracts.rates.open") }),
    );
  });

  it("an error without a known detail keeps the service's message", () => {
    expect(rateErrorText(violation(), en)).toBe("the service's English");
  });
});

// T024: a used rate closed before the last day it priced reads in the user's language, with both days.
describe("rateErrorText — closing before the last priced day", () => {
  const violation = (details: Record<string, string | number>) => ({
    code: "BUSINESS_RULE_VIOLATION" as const,
    message: "the service's English",
    retryable: false,
    details,
  });

  it("→ closesBeforePriced in en / fr / sv, never the service's English", () => {
    for (const lang of ["en", "fr", "sv"]) {
      const t = translator(lang);
      const text = rateErrorText(
        violation({ pricedUntil: "2026-03-01", validTo: "2026-02-28" }),
        t,
      );
      expect(text).toBe(
        t("contracts.rates.error.closesBeforePriced", { day: "2026-03-01", validTo: "2026-02-28" }),
      );
      expect(text).toContain("2026-03-01");
      expect(text).toContain("2026-02-28");
    }
  });
});
