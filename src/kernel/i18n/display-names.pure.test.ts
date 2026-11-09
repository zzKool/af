import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryName, countryOptions, languageName } from "./display-names";

describe("display names", () => {
  it("a country by name in the reader's language, whatever the case of the code", () => {
    expect(countryName("CH", "en")).toBe("Switzerland");
    expect(countryName("ch", "fr")).toBe("Suisse");
    expect(countryName("SE", "sv")).toBe("Sverige");
    expect(countryName("Schweiz", "en")).toBe("Schweiz");
    expect(countryName(null, "en")).toBeUndefined();
  });

  it("the picker's list: every code once, sorted by name", () => {
    const list = countryOptions("en");
    expect(list).toHaveLength(COUNTRY_CODES.length);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    const names = list.map((c) => c.name);
    expect(names.indexOf("Sweden")).toBeLessThan(names.indexOf("Switzerland"));
  });

  it("a language tag by name", () => {
    expect(languageName("fr-CH", "en")).toBe("French (Switzerland)");
    expect(languageName("sv-SE", "en")).toBe("Swedish (Sweden)");
  });
});
