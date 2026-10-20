import { describe, expect, test } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  resolveLocale,
} from "@/kernel/i18n/format-date";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";

describe("formatDateTime", () => {
  const testDate = new Date("2026-03-11T14:30:00Z");

  test("formats with en locale including date and time", () => {
    const result = formatDateTime(testDate, "en");
    expect(result).toContain("2026");
    expect(result).toMatch(/Mar|March/);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  test("formats with en-US locale", () => {
    const result = formatDateTime(testDate, "en-US");
    expect(result).toContain("2026");
    expect(result).toMatch(/Mar|March/);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  test("formats with de-DE locale", () => {
    const result = formatDateTime(testDate, "de-DE");
    expect(result).toContain("2026");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  test("accepts string date input", () => {
    const result = formatDateTime("2026-03-11T14:30:00Z", "en");
    expect(result).toContain("2026");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("formatDateShort", () => {
  const testDate = new Date("2026-03-11T14:30:00Z");

  test("formats with en locale", () => {
    const result = formatDateShort(testDate, "en");
    expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  });

  test("formats with de-DE locale", () => {
    const result = formatDateShort(testDate, "de-DE");
    expect(result).toMatch(/\d{1,2}\.\d{1,2}\.\d{2,4}/);
  });

  test("accepts string date input", () => {
    const result = formatDateShort("2026-03-11T14:30:00Z", "en");
    expect(result).toMatch(/\d/);
  });
});

describe("resolveLocale", () => {
  test("returns sv-SE for null", () => {
    expect(resolveLocale(null)).toBe("sv-SE");
  });

  test("returns sv-SE for undefined", () => {
    expect(resolveLocale(undefined)).toBe("sv-SE");
  });

  test("returns sv-SE for empty string", () => {
    expect(resolveLocale("")).toBe("sv-SE");
  });

  test("returns the locale if supported", () => {
    expect(resolveLocale("en-US")).toBe("en-US");
  });

  test("falls back to sv-SE for unsupported locale", () => {
    expect(resolveLocale("xx-YY")).toBe("sv-SE");
  });
});

describe("formatDate", () => {
  const testDate = new Date("2026-03-12T12:00:00Z");

  test("formats with sv-SE locale", () => {
    const result = formatDate(testDate, "sv-SE");
    expect(result).toBeTruthy();
    expect(result).toContain("2026");
  });

  test("formats with en-US locale", () => {
    const result = formatDate(testDate, "en-US");
    expect(result).toBeTruthy();
    expect(result).toContain("March");
  });

  test("formats with fr-FR locale", () => {
    const result = formatDate(testDate, "fr-FR");
    expect(result).toBeTruthy();
    expect(result).toContain("2026");
  });

  test("all SUPPORTED_LOCALES produce valid output", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const result = formatDate(testDate, locale);
      expect(result, `formatDate should work for ${locale}`).toBeTruthy();
      expect(result).toContain("2026");
    }
  });

  test("accepts string date input", () => {
    const result = formatDate("2026-03-12T12:00:00Z", "en-US");
    expect(result).toContain("2026");
  });

  test("uses sv-SE as fallback when no locale provided", () => {
    const result = formatDate(testDate);
    expect(result).toBeTruthy();
    expect(result).toContain("2026");
  });
});
