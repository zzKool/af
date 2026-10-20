import { describe, expect, it } from "vitest";
import { en } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import { translate, translator, uiLanguage } from "./translate";

describe("kernel i18n dictionary", () => {
  it("resolves the UI language from any locale tag and falls back to English", () => {
    expect(uiLanguage("fr")).toBe("fr");
    expect(uiLanguage("fr-CH")).toBe("fr");
    expect(uiLanguage("FR_fr")).toBe("fr");
    expect(uiLanguage("sv-SE")).toBe("en"); // no Swedish dictionary yet — a later data file
    expect(uiLanguage(null)).toBe("en");
    expect(uiLanguage("")).toBe("en");
  });

  it("translates with parameters", () => {
    expect(
      translate("en", "contracts.rates.error.overlap", { from: "2025-01-01", to: "open" }),
    ).toBe("This rate overlaps an existing rate (2025-01-01 → open)");
    expect(translate("fr-CH", "contracts.rates.state.current")).toBe("Actuel");
    expect(translate("de", "contracts.rates.state.current")).toBe("Current");
    expect(translator("fr")("contracts.rates.error.inUse", { n: 3 })).toContain("3 ligne(s)");
    // an unknown placeholder is left visible rather than silently dropped
    expect(translate("en", "contracts.rates.error.overlap", { from: "x" })).toContain("{to}");
  });

  it("every dictionary has every key and no empty strings", () => {
    const keys = Object.keys(en) as (keyof typeof en)[];
    for (const key of keys) {
      expect(fr[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
    expect(Object.keys(fr).sort()).toEqual([...keys].sort());
  });
});
