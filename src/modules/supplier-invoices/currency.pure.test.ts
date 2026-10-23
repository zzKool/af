import { describe, expect, it } from "vitest";
import { CURRENCIES } from "@/kernel/nav/constants";
import { parseCurrency } from "./currency";

describe("parseCurrency (audit 30)", () => {
  it("keeps every app currency", () => {
    for (const c of CURRENCIES) expect(parseCurrency(c)).toBe(c);
  });

  it("is null for a code outside the app's currencies, empty or missing", () => {
    expect(parseCurrency("GBP")).toBeNull();
    expect(parseCurrency("chf")).toBeNull();
    expect(parseCurrency("")).toBeNull();
    expect(parseCurrency(null)).toBeNull();
    expect(parseCurrency(undefined)).toBeNull();
  });
});
