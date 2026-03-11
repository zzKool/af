import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import {
  BASE_CURRENCY,
  CURRENCIES,
  DEFAULT_VAT_RATE_CH,
  DEFAULT_VAT_RATE_CH_STR,
  DEFAULT_VAT_RATE_SE,
  DEFAULT_VAT_RATE_SE_STR,
} from "./constants";

describe("client-safe import guard", () => {
  test("constants.ts does not import @prisma/client", () => {
    const content = fs.readFileSync(path.resolve(import.meta.dirname, "constants.ts"), "utf-8");
    expect(content).not.toMatch(/from\s+["']@prisma\/client["']/);
  });

  test("format-currency.ts does not import @prisma/client", () => {
    const content = fs.readFileSync(
      path.resolve(import.meta.dirname, "format-currency.ts"),
      "utf-8",
    );
    expect(content).not.toMatch(/from\s+["']@prisma\/client["']/);
  });
});

describe("constants", () => {
  test("CURRENCIES contains exactly SEK, CHF, EUR, USD", () => {
    expect(CURRENCIES).toEqual(["SEK", "CHF", "EUR", "USD"]);
  });

  test("BASE_CURRENCY is SEK", () => {
    expect(BASE_CURRENCY).toBe("SEK");
  });

  test("DEFAULT_VAT_RATE_SE equals 25 and string version equals '25'", () => {
    expect(DEFAULT_VAT_RATE_SE).toBe(25);
    expect(DEFAULT_VAT_RATE_SE_STR).toBe("25");
  });

  test("DEFAULT_VAT_RATE_CH equals 7.7 and string version equals '7.7'", () => {
    expect(DEFAULT_VAT_RATE_CH).toBe(7.7);
    expect(DEFAULT_VAT_RATE_CH_STR).toBe("7.7");
  });

  test("string VAT rate produces exact Decimal", () => {
    const decimal = new Prisma.Decimal(DEFAULT_VAT_RATE_CH_STR);
    expect(decimal.equals(new Prisma.Decimal("7.7"))).toBe(true);
  });

  test("VAT rate arithmetic via string constant is exact", () => {
    const result = new Prisma.Decimal("1000")
      .times(new Prisma.Decimal(DEFAULT_VAT_RATE_CH_STR))
      .dividedBy(100);
    expect(result.toDecimalPlaces(2).equals(new Prisma.Decimal("77.00"))).toBe(true);
  });
});
