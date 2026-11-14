import { describe, expect, it } from "vitest";
import { en } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import { sv } from "./dictionaries/sv";
import { pluralise, translate, translator, uiLanguage } from "./translate";

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
    expect(translator("fr")("contracts.rates.error.inUse", { n: 3 })).toContain("3 lignes");
    expect(translate("sv-SE", "invoices.state.paid")).toBe("Betald");
    expect(translator("sv")("banking.import.done", { imported: 3, duplicates: 1, errors: 0 })).toBe(
      "3 importerade · 1 dubbletter · 0 fel",
    );
    // an unknown placeholder is left visible rather than silently dropped
    expect(translate("en", "contracts.rates.error.overlap", { from: "x" })).toContain("{to}");
  });

  it("never shows `(s)`: the word agrees with the number before it, or with the count it is given", () => {
    const cases: [string, string][] = [
      ["20 bank line(s) to justify", "20 bank lines to justify"],
      ["1 row(s) left", "1 row left"],
      ["Fetch the 22 missing day(s)", "Fetch the 22 missing days"],
      ["2 invoice(s) issued · 1 not paid yet", "2 invoices issued · 1 not paid yet"],
      ["3 step(s) left: 1 bank row(s) to justify", "3 steps left: 1 bank row to justify"],
      ["Northwind — remembered (3 time(s))", "Northwind — remembered (3 times)"],
      ["Booked 1 day(s) before the date (2026-07-06)", "Booked 1 day before the date (2026-07-06)"],
      ["1.5 day(s)", "1.5 days"],
      ["0 SEK. 1 document(s)", "0 SEK. 1 document"],
      ["1 250 row(s)", "1 250 rows"],
      ["transaction(s) bancaire(s) créé(s)", "transactions bancaires créés"],
    ];
    for (const [text, read] of cases) expect(pluralise(text)).toBe(read);
    // no number in the text: the first numeric parameter decides
    expect(pluralise("bank transaction(s) created", { count: 1 })).toBe("bank transaction created");
    expect(translate("en", "dashboard.action.rows_to_justify", { count: 1 })).toBe(
      "1 bank line to justify",
    );
    expect(translate("en", "dashboard.action.rows_to_justify", { count: 20 })).toBe(
      "20 bank lines to justify",
    );
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
