import { describe, expect, test } from "vitest";
import { formatNumber } from "@/kernel/money/format-number";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";

describe("formatNumber", () => {
  test("formats positive integer with sv-SE", () => {
    const result = formatNumber(12500, "sv-SE");
    expect(result).toBeTruthy();
    // sv-SE uses non-breaking space as thousands separator
    expect(result.replace(/\s/g, "")).toContain("12500");
  });

  test("formats positive integer with en-US", () => {
    const result = formatNumber(12500, "en-US");
    expect(result).toBe("12,500");
  });

  test("formats zero", () => {
    const result = formatNumber(0, "en-US");
    expect(result).toBe("0");
  });

  test("formats negative number", () => {
    const result = formatNumber(-1234, "en-US");
    // Should contain minus sign and formatted number
    expect(result.replace(/[^0-9,.-]/g, "")).toContain("1,234");
  });

  test("formats large number", () => {
    const result = formatNumber(1_000_000, "en-US");
    expect(result).toBe("1,000,000");
  });

  test("formats decimal number with fr-FR", () => {
    const result = formatNumber(1234.56, "fr-FR");
    expect(result).toBeTruthy();
    // fr-FR uses comma for decimal, space for thousands
    expect(result).toContain(",");
  });

  test("all SUPPORTED_LOCALES produce valid output", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const result = formatNumber(12500.5, locale);
      expect(result, `formatNumber should work for ${locale}`).toBeTruthy();
    }
  });

  test("uses sv-SE fallback when no locale provided", () => {
    const result = formatNumber(12500);
    expect(result).toBeTruthy();
  });

  test("accepts Intl.NumberFormatOptions", () => {
    const result = formatNumber(0.75, "en-US", { style: "percent" });
    expect(result).toBe("75%");
  });
});
