import { describe, expect, it } from "vitest";
import { en } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import { sv } from "./dictionaries/sv";
import { translate, translator, uiLanguage } from "./translate";

describe("kernel i18n dictionary", () => {
  it("resolves the UI language from any locale tag and falls back to English", () => {
    expect(uiLanguage("fr")).toBe("fr");
    expect(uiLanguage("fr-CH")).toBe("fr");
    expect(uiLanguage("FR_fr")).toBe("fr");
    expect(uiLanguage("sv-SE")).toBe("sv");
    expect(uiLanguage("de-CH")).toBe("en"); // no German dictionary — English stands
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
    expect(translate("sv-SE", "invoices.state.paid")).toBe("Betald");
    expect(translator("sv")("banking.import.done", { imported: 3, duplicates: 1, errors: 0 })).toBe(
      "3 importerade · 1 dubbletter · 0 fel",
    );
    // an unknown placeholder is left visible rather than silently dropped
    expect(translate("en", "contracts.rates.error.overlap", { from: "x" })).toContain("{to}");
  });

  it("English has every key non-empty; fr and sv hold no orphan key, no empty string, the same placeholders (D62)", () => {
    const keys = Object.keys(en) as (keyof typeof en)[];
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keys) expect(en[key], key).toBeTruthy();
    for (const dict of [fr, sv]) {
      for (const [key, value] of Object.entries(dict) as [keyof typeof en, string][]) {
        // a translation of a key that no longer exists is dead weight — delete it with the English one
        expect(keys, `orphan key ${key}`).toContain(key);
        expect(value, key).toBeTruthy();
        // a translation that drops or misspells a placeholder would show the raw `{name}` on screen
        expect(placeholders(value), key).toEqual(placeholders(en[key]));
      }
    }
  });

  it("a key the language lacks shows its English, key by key — never the key itself (D62)", () => {
    const missingInFr = (Object.keys(en) as (keyof typeof en)[]).find((k) => !(k in fr));
    // today every key is translated; the rule is what matters: fall back per key, not per language
    if (missingInFr) expect(translate("fr", missingInFr)).toBe(en[missingInFr]);
    expect(translate("fr", "common.save")).toBe("Enregistrer");
  });
});
