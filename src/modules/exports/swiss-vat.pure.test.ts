// The return on the harvest's scenarios (specs/invoices/fixtures/swiss-vat-cases.json, SC-001) — v1's cases mapped
// to the v3 model (credit notes are positive documents of type credit_note; input VAT is the stored amount;
// membership is the query's, so the status / currency rules of V9 are the deviations listed below), plus the
// v3 corrections of R33 / R34 (old-rate rows, credit notes reduce the taxed base, no default to standard).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import {
  computeSwissVatReturn,
  csvFileName,
  FORM_FIELDS,
  quarterBounds,
  quartersBetween,
  rateKey,
  swissVatCsv,
} from "./swiss-vat";
import type { InputVatSourceRow, ReturnInvoice, SwissVatLine } from "./types";

const D = Prisma.Decimal;

type Fixture = {
  quarterBoundaries: { year: number; quarter: number; start: string; end: string }[];
  periodLabelExamples: { invoiceDate: string; label: string }[];
  cases: {
    id: string;
    invoices?: {
      number: string;
      date: string;
      status: string;
      currency: string;
      clientCountry: string | null;
      net: string;
      lines?: { net: string; rate: string | null }[];
    }[];
    supplierInvoiceLines?: { number: string; date: string; net: string; rate: string }[];
    expenses?: { ref: string; date: string; gross: string; rate: string }[];
    expected: Record<string, unknown>;
  }[];
};

const FIXTURE: Fixture = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "specs", "invoices", "fixtures", "swiss-vat-cases.json"),
    "utf8",
  ),
);
const PERIOD = "CH 2024/Q4";
const TODAY = "2025-01-15";

/** v3 membership: every issued document (SENT, PAID, PARTIALLY_PAID — and FINALIZED = issued, D23) dated in the quarter. */
const ISSUED = new Set(["SENT", "PAID", "PARTIALLY_PAID", "FINALIZED"]);

/**
 * A v1 case as the v3 query hands it over: the taxed part per rate (as the invoice's stored `vatByRate`), the 0 %
 * part apart. v1 put the rate on every line and decided "abroad" by the country; v3 stores 0 % for a client abroad
 * (`vatTreatmentFor`) and decides by the stored rate (lesson 21) — so a v1 foreign line becomes a 0 % line here.
 */
function toInvoice(i: NonNullable<Fixture["cases"][number]["invoices"]>[number]): ReturnInvoice {
  const credit = new D(i.net).lt(0);
  const swiss = i.clientCountry === null || i.clientCountry === "CH";
  const byRate = new Map<string, InstanceType<typeof D>>();
  for (const l of i.lines ?? [{ net: i.net, rate: "8.1" }]) {
    const rate = swiss ? (l.rate ?? "8.1") : "0";
    byRate.set(rate, (byRate.get(rate) ?? new D(0)).plus(new D(l.net).abs()));
  }
  const rates = [...byRate.entries()]
    .filter(([rate]) => rate !== "0")
    .map(([rate, base]) => ({
      rate,
      base: base.toFixed(2),
      vat: base.mul(rate).div(100).toDecimalPlaces(2).toFixed(2),
    }));
  // a non-CHF invoice is converted at 1:1 here (the query converts for real; the warning is what matters)
  const conversion = i.currency === "CHF" ? null : { rate: "1.000000", source: "ecb_daily" };
  return {
    id: i.number,
    number: i.number,
    type: credit ? "credit_note" : "invoice",
    issueDate: i.date,
    client: "Client",
    clientCountry: i.clientCountry,
    swissClient: swiss,
    currency: i.currency,
    net: new D(i.net).abs().toFixed(2),
    vat: rates.reduce((s, r) => s.plus(r.vat), new D(0)).toFixed(2),
    rates,
    zeroRated: (byRate.get("0") ?? new D(0)).toFixed(2),
    conversion,
  };
}

function sources(c: Fixture["cases"][number]): InputVatSourceRow[] {
  const out: InputVatSourceRow[] = [];
  for (const s of c.supplierInvoiceLines ?? []) {
    out.push({
      kind: "supplier_invoice",
      id: s.number,
      key: s.number,
      label: s.number,
      date: s.date,
      currency: "CHF",
      net: s.net,
      vat: new D(s.net).mul(s.rate).div(100).toDecimalPlaces(2).toFixed(2),
      conversion: null,
    });
  }
  for (const e of c.expenses ?? []) {
    // the stored VAT of a receipt: gross × rate / (100 + rate), as OCR'd or typed
    const vat = new D(e.gross).mul(e.rate).div(new D(100).plus(e.rate)).toDecimalPlaces(2);
    out.push({
      kind: "expense",
      id: e.ref,
      key: e.ref,
      label: e.ref,
      date: e.date,
      currency: "CHF",
      net: new D(e.gross).minus(vat).toFixed(2),
      vat: vat.toFixed(2),
      conversion: null,
    });
  }
  return out;
}

const byRef = (lines: SwissVatLine[]) => Object.fromEntries(lines.map((l) => [l.ref, l]));

/** Where v3 deliberately differs from v1's expectation. */
const V3: Record<string, Record<string, unknown>> = {
  // the credit note reduces the taxed base too: 379 == 299, no plausibility warning (R34)
  "V4-credit-note-as-negative-invoice": {
    ref299: "9000.00",
    ref303: { base: "9000.00", tax: "729.00" },
    ref379: "9000.00",
    warnings: [],
  },
  // issued counts even when not sent (D23); a non-CHF invoice is converted, with a warning, not dropped (D23)
  "V9-excluded-by-status-currency-or-date": { ref200: "200.00" },
};

describe("the Swiss VAT return on the harvest's cases", () => {
  it("quarter boundaries and period labels", () => {
    for (const q of FIXTURE.quarterBoundaries) {
      expect(quarterBounds(`CH ${q.year}/Q${q.quarter}`)).toMatchObject({
        from: q.start,
        to: q.end,
      });
    }
    expect(quartersBetween("CH 2025/Q3", "CH 2026/Q2")).toEqual([
      "CH 2026/Q2",
      "CH 2026/Q1",
      "CH 2025/Q4",
      "CH 2025/Q3",
    ]);
    expect(() => quarterBounds("2026/Q2")).toThrow(/period/);
    expect(csvFileName("CH 2026/Q2")).toBe("swiss-vat-2026-Q2.csv");
    expect(rateKey("8.10")).toBe("8.1");
  });

  for (const c of FIXTURE.cases) {
    it(c.id, () => {
      const { from, to } = quarterBounds(PERIOD);
      const invoices = (c.invoices ?? [])
        .filter((i) => ISSUED.has(i.status) && i.date >= from && i.date <= to)
        .map(toInvoice);
      const today = c.id.startsWith("V11") ? "2024-06-01" : TODAY;
      const { lines, warnings } = computeSwissVatReturn({
        period: PERIOD,
        invoices,
        inputSources: sources(c),
        manual: {},
        today,
      });
      const refs = byRef(lines);
      const expected = { ...c.expected, ...(V3[c.id] ?? {}) };
      for (const [key, value] of Object.entries(expected)) {
        if (key.startsWith("_")) continue;
        if (key === "warnings") {
          const want = (value as ({ type: string } | string)[]).map((w) =>
            typeof w === "string" ? w : w.type,
          );
          expect(warnings.map((w) => w.type).filter((t) => t !== "converted")).toEqual(want);
          continue;
        }
        if (key === "detailsInvoices") {
          expect(invoices).toHaveLength(value as number);
          continue;
        }
        if (key === "detailsInputSources") {
          expect(sources(c)).toHaveLength(value as number);
          continue;
        }
        const ref = key.replace("ref", "");
        const line = refs[ref];
        expect(line, `ref ${ref}`).toBeDefined();
        if (typeof value === "object" && value !== null) {
          expect({ base: line?.base, tax: line?.amount }).toEqual(value);
        } else {
          expect(line?.amount, `ref ${ref}`).toBe(value);
        }
      }
    });
  }
});

describe("v3 corrections", () => {
  const inv = (over: Partial<ReturnInvoice>): ReturnInvoice => ({
    id: "i",
    number: "VA26-INV-001",
    type: "invoice",
    issueDate: "2026-05-10",
    client: "Vaudoise",
    clientCountry: "CH",
    swissClient: true,
    currency: "CHF",
    net: "1000.00",
    vat: "81.00",
    rates: [{ rate: "8.1", base: "1000.00", vat: "81.00" }],
    zeroRated: "0.00",
    conversion: null,
    ...over,
  });

  it("a 7.7 % line (an old-rate correction) goes to row 302, never to 303 (R33)", () => {
    const { lines, warnings } = computeSwissVatReturn({
      period: "CH 2026/Q2",
      invoices: [
        inv({
          number: "A",
          net: "1000.00",
          vat: "77.00",
          rates: [{ rate: "7.7", base: "1000.00", vat: "77.00" }],
        }),
        inv({ number: "B" }),
      ],
      inputSources: [],
      manual: {},
      today: "2026-08-01",
    });
    const refs = byRef(lines);
    expect(refs["302"]).toMatchObject({ base: "1000.00", amount: "77.00" });
    expect(refs["303"]).toMatchObject({ base: "1000.00", amount: "81.00" });
    expect(refs["399"]?.amount).toBe("158.00");
    expect(refs["379"]?.amount).toBe("2000.00");
    expect(warnings).toEqual([]);
  });

  it("an unknown rate is a warning and lands nowhere (never defaulted to 8.1)", () => {
    const { lines, warnings } = computeSwissVatReturn({
      period: "CH 2026/Q2",
      invoices: [inv({ rates: [{ rate: "5", base: "1000.00", vat: "50.00" }], vat: "50.00" })],
      inputSources: [],
      manual: {},
      today: "2026-08-01",
    });
    expect(warnings.map((w) => w.type)).toEqual(["unknown_rate", "plausibility_mismatch"]);
    expect(byRef(lines)["303"]?.amount).toBe("0.00");
  });

  it("a foreign client's credit note nets the abroad turnover (200 and 221 both), nothing taxable moves", () => {
    const { lines, warnings } = computeSwissVatReturn({
      period: "CH 2026/Q2",
      invoices: [
        inv({
          number: "A",
          clientCountry: "DE",
          swissClient: false,
          rates: [],
          zeroRated: "1000.00",
          vat: "0.00",
        }),
        inv({
          number: "A-CN",
          type: "credit_note",
          clientCountry: "DE",
          swissClient: false,
          net: "200.00",
          vat: "0.00",
          rates: [],
          zeroRated: "200.00",
        }),
        inv({ number: "B" }),
      ],
      inputSources: [],
      manual: {},
      today: "2026-08-01",
    });
    const refs = byRef(lines);
    expect(refs["200"]?.amount).toBe("1800.00");
    expect(refs["221"]?.amount).toBe("800.00");
    expect(refs["235"]?.amount).toBe("0.00");
    expect(refs["299"]?.amount).toBe("1000.00");
    expect(refs["379"]?.amount).toBe("1000.00");
    expect(warnings).toEqual([]);
  });

  it("a client abroad billed at 8.1 % is taxed by the stored rate (303, 399), not counted as supplied abroad (lesson 21)", () => {
    const { lines, warnings } = computeSwissVatReturn({
      period: "CH 2026/Q2",
      invoices: [inv({ clientCountry: "DE", swissClient: false })],
      inputSources: [],
      manual: {},
      today: "2026-08-01",
    });
    const refs = byRef(lines);
    expect(refs["221"]?.amount).toBe("0.00");
    expect(refs["303"]).toMatchObject({ base: "1000.00", amount: "81.00" });
    expect(refs["399"]?.amount).toBe("81.00");
    expect(refs["299"]?.amount).toBe("1000.00");
    expect(warnings).toEqual([]);
  });

  it("a mixed invoice: the taxed part on its rate row, the 0 % part on 221; 0 % for a Swiss client is flagged", () => {
    const { lines, warnings } = computeSwissVatReturn({
      period: "CH 2026/Q2",
      invoices: [inv({ net: "1500.00", zeroRated: "500.00" })],
      inputSources: [],
      manual: {},
      today: "2026-08-01",
    });
    const refs = byRef(lines);
    expect(refs["200"]?.amount).toBe("1500.00");
    expect(refs["221"]?.amount).toBe("500.00");
    expect(refs["303"]).toMatchObject({ base: "1000.00", amount: "81.00" });
    expect(refs["299"]?.amount).toBe("1000.00");
    expect(refs["379"]?.amount).toBe("1000.00");
    expect(warnings.map((w) => w.type)).toEqual(["zero_rate_swiss_client"]);
  });

  it("manual refs enter the sums with their sign; 500 / 510 never both", () => {
    const { lines } = computeSwissVatReturn({
      period: "CH 2026/Q2",
      invoices: [inv({})],
      inputSources: [
        {
          kind: "expense",
          id: "e",
          key: "Ex213-Ut-01",
          label: "Hotel",
          date: "2026-05-02",
          currency: "CHF",
          net: "100.00",
          vat: "3.80",
          conversion: null,
        },
      ],
      manual: { "220": "100.00", "383": "10.00", "405": "5.00", "415": "2.50", "420": "1.00" },
      today: "2026-08-01",
    });
    const refs = byRef(lines);
    expect(refs["289"]?.amount).toBe("100.00");
    expect(refs["299"]?.amount).toBe("900.00");
    expect(refs["399"]?.amount).toBe("91.00"); // 81 + 383
    expect(refs["400"]?.amount).toBe("3.80");
    expect(refs["479"]?.amount).toBe("5.30"); // 3.80 + 5 − 2.5 − 1
    expect(refs["500"]?.amount).toBe("85.70");
    expect(refs["510"]?.amount).toBe("0.00");
  });

  it("a period that has not started / not ended yet is a warning, nothing else", () => {
    const empty = { invoices: [], inputSources: [], manual: {} };
    expect(
      computeSwissVatReturn({ ...empty, period: "CH 2026/Q4", today: "2026-08-01" }).warnings,
    ).toEqual([{ type: "future_period", message: "Selected period has not yet started" }]);
    expect(
      computeSwissVatReturn({ ...empty, period: "CH 2026/Q3", today: "2026-08-01" }).warnings.map(
        (w) => w.type,
      ),
    ).toEqual(["incomplete_period"]);
  });

  it("the CSV: ref;label;amount for every row, the rate rows with their base, the v1 file name", () => {
    const { lines } = computeSwissVatReturn({
      period: "CH 2026/Q2",
      invoices: [inv({})],
      inputSources: [],
      manual: {},
      today: "2026-08-01",
    });
    const csv = swissVatCsv(lines);
    expect(csv.split("\r\n")[0]).toBe("ref;label;amount");
    expect(csv).toContain("200;Total des contre-prestations convenues;1000.00");
    expect(csv).toContain("303;Taux normal 8.1 %;81.00");
    expect(csv).toContain("303.base;Taux normal 8.1 % — base;1000.00");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(1 + FORM_FIELDS.length + 6);
    expect(swissVatCsv(lines, "en")).toContain("200;Total agreed considerations;1000.00");
  });
});

// F71: the screens moved to the D40 kit (formatMoney, StateLabel, CodeChip) — the CSV the owner hands to the FTA
// must not move. Every harvest case, in both languages, against the file captured before the change.
describe("the CSV is byte-identical to the one before F71", () => {
  const GOLDEN = join(
    __dirname,
    "..",
    "..",
    "..",
    "specs",
    "exports",
    "fixtures",
    "swiss-vat-csv-golden.json",
  );

  it("every case, fr and en", () => {
    expect(allCasesCsv()).toBe(JSON.parse(readFileSync(GOLDEN, "utf8")).csv);
  });
});

function allCasesCsv(): string {
  const { from, to } = quarterBounds(PERIOD);
  const out: string[] = [];
  for (const c of FIXTURE.cases) {
    const invoices = (c.invoices ?? [])
      .filter((i) => ISSUED.has(i.status) && i.date >= from && i.date <= to)
      .map(toInvoice);
    const { lines } = computeSwissVatReturn({
      period: PERIOD,
      invoices,
      inputSources: sources(c),
      manual: { "220": "100.00", "405": "12.50" },
      today: c.id.startsWith("V11") ? "2024-06-01" : TODAY,
    });
    for (const lang of ["fr", "en"] as const) {
      out.push(`### ${c.id} ${lang}\r\n${swissVatCsv(lines, lang)}`);
    }
  }
  return out.join("");
}
