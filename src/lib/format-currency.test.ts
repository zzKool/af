import { describe, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import { DEFAULT_VAT_RATE_CH_STR } from "./constants";
import { formatCurrency } from "./format-currency";

// --- Precision tests (Prisma.Decimal arithmetic) ---

describe("decimal precision", () => {
  test("0.1 + 0.2 equals 0.3 exactly", () => {
    const result = new Prisma.Decimal("0.1").plus("0.2");
    expect(result.equals(new Prisma.Decimal("0.3"))).toBe(true);
  });

  test("1999.99 + 0.01 equals 2000.00", () => {
    const result = new Prisma.Decimal("1999.99").plus("0.01");
    expect(result.equals(new Prisma.Decimal("2000.00"))).toBe(true);
  });

  test("100 / 3 rounded to 2dp equals 33.33", () => {
    const result = new Prisma.Decimal("100")
      .dividedBy("3")
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    expect(result.equals(new Prisma.Decimal("33.33"))).toBe(true);
  });

  test("100 * 0.25 equals 25.00", () => {
    const result = new Prisma.Decimal("100").times("0.25");
    expect(result.equals(new Prisma.Decimal("25.00"))).toBe(true);
  });

  test("99999999999.99 + 0.01 equals 100000000000.00 (boundary)", () => {
    const result = new Prisma.Decimal("99999999999.99").plus("0.01");
    expect(result.equals(new Prisma.Decimal("100000000000.00"))).toBe(true);
  });

  test("0 - 0.01 equals -0.01 (negative)", () => {
    const result = new Prisma.Decimal("0").minus("0.01");
    expect(result.equals(new Prisma.Decimal("-0.01"))).toBe(true);
  });

  test("1000 * CH VAT rate / 100 equals 77.00", () => {
    const result = new Prisma.Decimal("1000").times(DEFAULT_VAT_RATE_CH_STR).dividedBy("100");
    expect(result.toDecimalPlaces(2).equals(new Prisma.Decimal("77.00"))).toBe(true);
  });
});

// --- Teaching / anti-pattern tests ---

describe("floating-point danger demonstrations", () => {
  test("demonstrates floating-point danger with number constructor", () => {
    const bad = new Prisma.Decimal(0.1 + 0.2);
    const good = new Prisma.Decimal("0.1").plus("0.2");
    expect(bad.equals(new Prisma.Decimal("0.3"))).toBe(false); // proves the danger
    expect(good.equals(new Prisma.Decimal("0.3"))).toBe(true); // string is safe
  });

  test("demonstrates compound JS arithmetic danger before Decimal wrapping", () => {
    // Simulates the mistake: doing JS arithmetic first, then wrapping in Decimal
    const jsSum = 0.1 + 0.2 + 0.3; // JS evaluates to 0.6000000000000001
    const bad = new Prisma.Decimal(jsSum);
    // Correct: keep everything in Decimal from the start
    const good = new Prisma.Decimal("0.1").plus("0.2").plus("0.3");
    expect(bad.equals(new Prisma.Decimal("0.6"))).toBe(false); // JS arithmetic corrupted it
    expect(good.equals(new Prisma.Decimal("0.6"))).toBe(true); // Decimal arithmetic is exact
  });
});

// --- Formatting tests (4 currencies x 4 scenarios) ---

describe("formatCurrency — SEK", () => {
  test("formats standard amount", () => {
    expect(formatCurrency("12500.00", "SEK")).toBe("12\u00A0500,00");
  });

  test("formats zero", () => {
    expect(formatCurrency("0", "SEK")).toBe("0,00");
  });

  test("formats negative amount", () => {
    expect(formatCurrency("-1234.56", "SEK")).toBe("-1\u00A0234,56");
  });

  test("formats large amount", () => {
    expect(formatCurrency("1000000.00", "SEK")).toBe("1\u00A0000\u00A0000,00");
  });
});

describe("formatCurrency — CHF", () => {
  test("formats standard amount", () => {
    expect(formatCurrency("12500.00", "CHF")).toBe("12'500.00");
  });

  test("formats zero", () => {
    expect(formatCurrency("0", "CHF")).toBe("0.00");
  });

  test("formats negative amount", () => {
    expect(formatCurrency("-1234.56", "CHF")).toBe("-1'234.56");
  });

  test("formats large amount", () => {
    expect(formatCurrency("1000000.00", "CHF")).toBe("1'000'000.00");
  });
});

describe("formatCurrency — EUR", () => {
  test("formats standard amount", () => {
    expect(formatCurrency("12500.00", "EUR")).toBe("12,500.00");
  });

  test("formats zero", () => {
    expect(formatCurrency("0", "EUR")).toBe("0.00");
  });

  test("formats negative amount", () => {
    expect(formatCurrency("-1234.56", "EUR")).toBe("-1,234.56");
  });

  test("formats large amount", () => {
    expect(formatCurrency("1000000.00", "EUR")).toBe("1,000,000.00");
  });
});

describe("formatCurrency — USD", () => {
  test("formats standard amount", () => {
    expect(formatCurrency("12500.00", "USD")).toBe("12,500.00");
  });

  test("formats zero", () => {
    expect(formatCurrency("0", "USD")).toBe("0.00");
  });

  test("formats negative amount", () => {
    expect(formatCurrency("-1234.56", "USD")).toBe("-1,234.56");
  });

  test("formats large amount", () => {
    expect(formatCurrency("1000000.00", "USD")).toBe("1,000,000.00");
  });
});

// --- Rounding tests (banker's rounding / ROUND_HALF_EVEN) ---

describe("banker's rounding (ROUND_HALF_EVEN)", () => {
  test("33.335 rounds to 33.34", () => {
    const result = new Prisma.Decimal("33.335").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    expect(result.toString()).toBe("33.34");
  });

  test("33.345 rounds to 33.34", () => {
    const result = new Prisma.Decimal("33.345").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    expect(result.toString()).toBe("33.34");
  });

  test("33.355 rounds to 33.36", () => {
    const result = new Prisma.Decimal("33.355").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    expect(result.toString()).toBe("33.36");
  });

  test("0.001 rounds to 0.00", () => {
    const result = new Prisma.Decimal("0.001").toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    expect(result.toFixed(2)).toBe("0.00");
  });
});

// --- Error handling tests ---

describe("formatCurrency — error handling", () => {
  test("throws TypeError for empty string", () => {
    expect(() => formatCurrency("", "SEK")).toThrow(TypeError);
  });

  test("throws TypeError for non-numeric string", () => {
    expect(() => formatCurrency("abc", "CHF")).toThrow(TypeError);
  });

  test("throws TypeError for >2 decimal places (unrounded input)", () => {
    expect(() => formatCurrency("1.999", "SEK")).toThrow(TypeError);
    expect(() => formatCurrency("33.335", "CHF")).toThrow(TypeError);
  });
});

// --- Standard input tests ---

describe("formatCurrency — standard inputs", () => {
  test("formats serialized Decimal string for SEK", () => {
    expect(formatCurrency("12500.00", "SEK")).toBe("12\u00A0500,00");
  });

  test("formats zero string for CHF", () => {
    expect(formatCurrency("0", "CHF")).toBe("0.00");
  });
});
