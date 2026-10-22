import { describe, expect, test } from "vitest";
import {
  acceptLanguageTagWithDictionary,
  resolveLocale,
  uiLanguageFromAcceptLanguage,
} from "@/kernel/i18n/locale";

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

describe("uiLanguageFromAcceptLanguage — the login / register pages' language", () => {
  test("the first language by quality that has a dictionary", () => {
    expect(uiLanguageFromAcceptLanguage("fr-CH,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(uiLanguageFromAcceptLanguage("sv-SE,sv;q=0.9")).toBe("sv");
    expect(uiLanguageFromAcceptLanguage("en;q=0.5,sv-SE;q=0.9")).toBe("sv");
  });

  test("skips a language without a dictionary instead of falling to English", () => {
    expect(uiLanguageFromAcceptLanguage("de-CH,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(uiLanguageFromAcceptLanguage("bs,sv;q=0.5")).toBe("sv");
  });

  test("equal qualities keep the header's order; q=0 means not wanted", () => {
    expect(uiLanguageFromAcceptLanguage("sv,fr")).toBe("sv");
    expect(uiLanguageFromAcceptLanguage("fr;q=0,sv;q=0.1")).toBe("sv");
  });

  test("English when nothing matches or the header is missing", () => {
    expect(uiLanguageFromAcceptLanguage(null)).toBe("en");
    expect(uiLanguageFromAcceptLanguage("")).toBe("en");
    expect(uiLanguageFromAcceptLanguage("de-DE,*")).toBe("en");
    expect(uiLanguageFromAcceptLanguage(";;;,,")).toBe("en");
  });
});

describe("acceptLanguageTagWithDictionary — the browser locale before any preference", () => {
  test("keeps the whole tag for formatting", () => {
    expect(acceptLanguageTagWithDictionary("de-CH,fr-CH;q=0.9,en;q=0.8")).toBe("fr-CH");
    expect(acceptLanguageTagWithDictionary("sv-SE,sv;q=0.9")).toBe("sv-SE");
    expect(acceptLanguageTagWithDictionary("en-GB,fr;q=0.5")).toBe("en-GB");
  });

  test("null when no language has a dictionary", () => {
    expect(acceptLanguageTagWithDictionary("de-CH,de;q=0.9")).toBeNull();
    expect(acceptLanguageTagWithDictionary(null)).toBeNull();
  });
});
