// The JSONB columns' mappers (lessons audit 29): valid values read back as stored, malformed ones never reach
// the sheet as a cast, and the write mappers round-trip through JSON.
import { describe, expect, it } from "vitest";
import {
  parsePrintedParties,
  parsePrintedReferences,
  parseVatByRate,
  printedPartiesToJson,
  printedReferencesToJson,
  vatByRateToJson,
} from "./json-columns";
import type { PrintedParties } from "./types";

const parties: PrintedParties = {
  tenant: {
    name: "AnalyticsFab AB",
    orgNumber: "559000-0000",
    address: "Placeholder street 1, 000 00 Stockholm, Sweden",
    email: "billing@example.test",
    website: null,
    logoUrl: null,
    vatNumber: "CHE-000.000.000 TVA",
    vatCountry: "CH",
  },
  partner: {
    name: "Client VA SA",
    address: { street: "Rue Exemple 10", postalCode: "1000", city: "Lausanne", country: "CH" },
    vatNumber: null,
    orgNumber: null,
    email: null,
  },
  bank: {
    bankName: "Nordea",
    accountHolder: "AnalyticsFab AB",
    iban: "SE00 0000 0000 0000 0000 0000",
    bic: "NDEASESS",
    accountNumber: null,
    currency: "CHF",
  },
};

/** What Postgres hands back: the written value through JSON. */
const stored = <T>(v: T) => JSON.parse(JSON.stringify(v));

describe("printed_parties", () => {
  it("round-trips, and a valid snapshot reads back as the very object stored", () => {
    const json = stored(printedPartiesToJson(parties));
    expect(json).toEqual(parties);
    expect(parsePrintedParties(json)).toBe(json);
  });

  it("an older snapshot without the later fields still reads (no bank, no e-mail / website / logo)", () => {
    const old = stored({
      tenant: {
        name: "AnalyticsFab AB",
        orgNumber: null,
        address: null,
        vatNumber: null,
        vatCountry: null,
      },
      partner: {
        name: "Client VA SA",
        address: null,
        vatNumber: null,
        orgNumber: null,
        email: null,
      },
      bank: null,
    });
    expect(parsePrintedParties(old)).toBe(old);
  });

  it("a draft (no snapshot) and a malformed value read as null — the sheet falls back to the live parties", () => {
    expect(parsePrintedParties(null)).toBeNull();
    expect(parsePrintedParties([])).toBeNull();
    expect(parsePrintedParties({ tenant: { name: "x" } })).toBeNull();
    expect(
      parsePrintedParties(stored({ ...parties, partner: { ...parties.partner, name: 42 } })),
    ).toBeNull();
  });

  it("an address's undefined keys are dropped on write, as JSON did", () => {
    const json = printedPartiesToJson({
      ...parties,
      partner: { ...parties.partner, address: { city: "Lausanne", street: undefined } },
    });
    expect(json.partner).toMatchObject({ address: { city: "Lausanne" } });
    expect(Object.keys((json.partner as { address: object }).address)).toEqual(["city"]);
  });
});

describe("printed_references and vat_by_rate", () => {
  it("round-trip", () => {
    const refs = [
      { label: "Bon de commande", value: "4500000000" },
      { label: "N° Fournisseur", value: "000000" },
    ];
    expect(parsePrintedReferences(stored(printedReferencesToJson(refs)))).toEqual(refs);
    const vat = [{ rate: "8.1", base: "24000.00", vat: "1944.00" }];
    expect(parseVatByRate(stored(vatByRateToJson(vat)))).toEqual(vat);
  });

  it("no column reads as [], malformed entries are left out", () => {
    expect(parsePrintedReferences(null)).toEqual([]);
    expect(parseVatByRate(null)).toEqual([]);
    expect(parsePrintedReferences({ label: "a", value: "b" })).toEqual([]);
    expect(parsePrintedReferences([{ label: "a", value: "b" }, { label: "a" }, "x", null])).toEqual(
      [{ label: "a", value: "b" }],
    );
    expect(
      parseVatByRate([
        { rate: "8.1", base: "1.00", vat: "0.08" },
        { rate: 8.1, base: "1", vat: "0" },
      ]),
    ).toEqual([{ rate: "8.1", base: "1.00", vat: "0.08" }]);
  });
});
