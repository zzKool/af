import { describe, expect, test } from "vitest";
import { resolveLocale } from "@/kernel/i18n/locale";

describe("resolveLocale", () => {
  test("returns 'en' for null header", () => {
    expect(resolveLocale(null)).toBe("en");
  });

  test("returns 'en' for empty string", () => {
    expect(resolveLocale("")).toBe("en");
  });

  test("returns single locale", () => {
    expect(resolveLocale("de-DE")).toBe("de-DE");
  });

  test("returns highest quality locale", () => {
    expect(resolveLocale("en-US,en;q=0.9,sv;q=0.8")).toBe("en-US");
  });

  test("respects quality factor ordering", () => {
    expect(resolveLocale("en;q=0.5,sv-SE;q=0.9,de;q=0.7")).toBe("sv-SE");
  });

  test("handles missing quality as 1.0", () => {
    expect(resolveLocale("sv-SE,en;q=0.9")).toBe("sv-SE");
  });

  test("handles complex Accept-Language header", () => {
    expect(resolveLocale("en-US,en;q=0.9,sv-SE;q=0.8,de;q=0.7")).toBe("en-US");
  });

  test("handles wildcard by falling back to en", () => {
    expect(resolveLocale("*")).toBe("en");
  });

  test("handles malformed input gracefully", () => {
    expect(resolveLocale(";;;,,")).toBe("en");
    expect(resolveLocale(",,,")).toBe("en");
  });
});
