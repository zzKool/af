import { describe, expect, test } from "vitest";
import { CURRENCIES } from "@/kernel/nav/constants";
import { DEFAULT_CURRENCY_PAIRS } from "./ecb-rates";

// Audit 30: the fetched pairs were a list of their own beside CURRENCIES.
describe("the fetched ECB pairs", () => {
  test("one EUR/X per currency of CURRENCIES, EUR aside — nothing missing, nothing extra", () => {
    const quoted = DEFAULT_CURRENCY_PAIRS.map((p) => p.split("/"));
    expect(quoted.every(([base]) => base === "EUR")).toBe(true);
    expect(quoted.map(([, ccy]) => ccy).sort()).toEqual(
      CURRENCIES.filter((c) => c !== "EUR").sort(),
    );
  });

  test("today's pairs, in the order the settings page lists them", () => {
    expect(DEFAULT_CURRENCY_PAIRS).toEqual(["EUR/SEK", "EUR/CHF", "EUR/USD"]);
  });
});
