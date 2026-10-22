import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import fixture from "../../../specs/invoices/fixtures/invoice-totals-cases.json";
import {
  baseTotals,
  formatVatPercent,
  invoiceTotals,
  type LineInput,
  lineTotals,
  TotalsError,
} from "./totals";

type FixtureLine = {
  quantity: string;
  unitPrice: string;
  vatRate: string;
  discountType?: "PERCENTAGE" | "FIXED";
  discountPercent?: string;
  discountFixed?: string;
};
type FixtureCase = {
  id: string;
  lines?: FixtureLine[];
  invoiceDiscount?: { discountType: string; discountPercent: string | null } | null;
  expectedLines?: { netAmount: string; vatAmount: string; discountAmount: string }[];
  expected?: {
    subtotal: string;
    discountAmount?: string;
    netAmount?: string;
    vatAmount: string;
    totalAmount: string;
    vatBreakdown?: { rate: string; amount: string }[];
  };
};

const toLine = (l: FixtureLine): LineInput => ({
  quantity: l.quantity,
  unitPrice: l.unitPrice,
  vatRate: l.vatRate,
  discountPercent: l.discountType === "PERCENTAGE" ? l.discountPercent : null,
  discountFixed: l.discountType === "FIXED" ? l.discountFixed : null,
});

const cases = fixture.cases as FixtureCase[];
const standard = cases.filter((c) => c.lines && c.expected && /^[A-H]/.test(c.id));

describe("invoice totals — harvested cases (specs/invoices/fixtures/invoice-totals-cases.json)", () => {
  it.each(standard.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const result = invoiceTotals(
      (c.lines ?? []).map(toLine),
      c.invoiceDiscount?.discountType === "PERCENTAGE" ? c.invoiceDiscount.discountPercent : null,
    );
    expect(result.subtotal).toBe(c.expected?.subtotal);
    expect(result.vat).toBe(c.expected?.vatAmount);
    expect(result.total).toBe(c.expected?.totalAmount);
    if (c.expected?.discountAmount) expect(result.discountAmount).toBe(c.expected.discountAmount);
    if (c.expected?.netAmount) expect(result.net).toBe(c.expected.netAmount);
    if (c.expected?.vatBreakdown) {
      expect(result.vatByRate.map((r) => ({ rate: r.rate, amount: r.vat }))).toEqual(
        c.expected.vatBreakdown,
      );
    }
    (c.expectedLines ?? []).forEach((exp, i) => {
      expect(result.lines[i].net).toBe(exp.netAmount);
      expect(result.lines[i].discountAmount).toBe(exp.discountAmount);
      expect(result.lines[i].vatAmount).toBe(exp.vatAmount);
    });
  });

  it("I — a full credit note has the original's totals (the sign is a print concern)", () => {
    const a = standard.find((c) => c.id.startsWith("A"));
    const i = cases.find((c) => c.id.startsWith("I"));
    const result = invoiceTotals((a?.lines ?? []).map(toLine));
    expect(result.total).toBe(i?.expected?.totalAmount);
  });

  it("J — partial credit by quantity scales a percent discount with the quantity", () => {
    // case C line (20 × 1 200, 10 %) credited 5 of 20
    const result = invoiceTotals([
      { quantity: "5", unitPrice: "1200.00", vatRate: "8.1", discountPercent: "10" },
    ]);
    expect(result.lines[0]).toMatchObject({
      gross: "6000.00",
      discountAmount: "600.00",
      net: "5400.00",
      vatAmount: "437.40",
    });
    expect(result.total).toBe("5837.40");
  });

  it("K — a fixed line discount larger than the line is refused (v1 produced a negative line)", () => {
    expect(() =>
      lineTotals({ quantity: "1", unitPrice: "100.00", vatRate: "8.1", discountFixed: "150.00" }),
    ).toThrow(TotalsError);
    expect(() =>
      lineTotals({ quantity: "1", unitPrice: "100.00", vatRate: "8.1", discountFixed: "150.00" }),
    ).toThrow(/exceeds/);
  });

  it("L — the header discount is a percent; anything else never reaches the arithmetic", () => {
    // the service's schema only accepts a percent, so a 'FIXED' header discount cannot be silently ignored:
    // here the percent path is exercised and a bad percent is refused
    expect(() => invoiceTotals([{ quantity: "1", unitPrice: "100", vatRate: "0" }], "150")).toThrow(
      /between 0 and 100/,
    );
    expect(invoiceTotals([{ quantity: "20", unitPrice: "1200", vatRate: "8.1" }], null).total).toBe(
      "25944.00",
    );
  });

  it("validation: negative quantity / price, bad VAT rate, non-numbers", () => {
    expect(() => lineTotals({ quantity: "-1", unitPrice: "1", vatRate: "0" })).toThrow(/negative/);
    expect(() => lineTotals({ quantity: "1", unitPrice: "-1", vatRate: "0" })).toThrow(/negative/);
    expect(() => lineTotals({ quantity: "1", unitPrice: "1", vatRate: "101" })).toThrow(/VAT rate/);
    expect(() => lineTotals({ quantity: "abc", unitPrice: "1", vatRate: "0" })).toThrow(
      /not a number/,
    );
    expect(invoiceTotals([]).total).toBe("0.00");
  });

  it("VAT percent prints as an integer or one decimal", () => {
    expect(formatVatPercent("25")).toBe("25");
    expect(formatVatPercent("25.00")).toBe("25");
    expect(formatVatPercent("8.1")).toBe("8.1");
    expect(formatVatPercent("2.60")).toBe("2.6");
  });
});

// --- property: the identities every printed document must satisfy ---

const D = Prisma.Decimal;
const amount = (max: number, dp: number) =>
  fc.integer({ min: 0, max: max * 10 ** dp }).map((n) => new D(n).div(10 ** dp).toFixed(dp));
const line = fc.record({
  quantity: amount(400, 1),
  unitPrice: amount(5000, 2),
  vatRate: fc.constantFrom("0", "2.6", "3.8", "8.1", "12", "25"),
  discountPercent: fc.option(amount(100, 0), { nil: null }),
});

describe("invoice totals — property (200 runs)", () => {
  it("subtotal = Σ net; total = net + Σ VAT by rate; 2 decimals everywhere; breakdown ascending, no zero rows", () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 12 }),
        fc.option(amount(100, 0), { nil: null }),
        (lines, headerPct) => {
          const t = invoiceTotals(lines, headerPct);
          const sumNet = t.lines.reduce((s, l) => s.add(new D(l.net)), new D(0));
          expect(t.subtotal).toBe(sumNet.toFixed(2));
          const sumVat = t.vatByRate.reduce((s, r) => s.add(new D(r.vat)), new D(0));
          expect(t.vat).toBe(sumVat.toFixed(2));
          expect(t.total).toBe(new D(t.net).add(sumVat).toFixed(2));
          expect(new D(t.net)).toEqual(new D(t.subtotal).sub(new D(t.discountAmount)));
          for (const v of [t.subtotal, t.discountAmount, t.net, t.vat, t.total])
            expect(v).toMatch(/^\d+\.\d{2}$/);
          for (let i = 1; i < t.vatByRate.length; i++)
            expect(new D(t.vatByRate[i].rate).gt(new D(t.vatByRate[i - 1].rate))).toBe(true);
          for (const r of t.vatByRate) expect(new D(r.vat).gt(0)).toBe(true);
          // the header discount never makes VAT exceed the undiscounted VAT
          const undiscounted = invoiceTotals(lines, null);
          expect(new D(t.vat).lte(new D(undiscounted.vat))).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// --- base currency (F57, lessons audit 8): the SEK figures written once at issue reconcile ---

describe("base totals", () => {
  it("24 000 CHF, 10 % header discount, 8.1 % VAT at 11.987041: the subtotal is converted after the discount", () => {
    const t = invoiceTotals([{ quantity: "20", unitPrice: "1200", vatRate: "8.1" }], "10");
    expect(t).toMatchObject({ subtotal: "24000.00", discountAmount: "2400.00", vat: "1749.60" });
    expect(
      baseTotals(
        { subtotal: t.subtotal, discountAmount: t.discountAmount, vat: t.vat },
        "11.987041",
      ),
    ).toEqual({
      subtotalBase: "258920.09", // 21 600 × rate — not 287 688.98 (24 000 × rate, before the discount)
      vatBase: "20972.53",
      totalBase: "279892.62", // = the two parts; total × rate would be 279 892.61 (one rounding fewer)
    });
  });

  it("SEK → SEK at 1 is the document's own figures", () => {
    expect(
      baseTotals({ subtotal: "1000.00", discountAmount: "50.00", vat: "237.50" }, "1"),
    ).toEqual({
      subtotalBase: "950.00",
      vatBase: "237.50",
      totalBase: "1187.50",
    });
  });
});

// six-decimal ECB-style rates between 0.05 and 20
const rate = fc
  .integer({ min: 50_000, max: 20_000_000 })
  .map((n) => new D(n).div(1_000_000).toFixed(6));

describe("base totals — property (300 runs, a header discount on every document)", () => {
  it("subtotalBase + vatBase = totalBase exactly; subtotalBase is the discounted net converted; total within 0.01 of total × rate", () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 12 }),
        amount(100, 0).filter((p) => p !== "0"),
        rate,
        (lines, headerPct, r) => {
          const t = invoiceTotals(lines, headerPct);
          const b = baseTotals(
            { subtotal: t.subtotal, discountAmount: t.discountAmount, vat: t.vat },
            r,
          );
          for (const v of [b.subtotalBase, b.vatBase, b.totalBase])
            expect(v).toMatch(/^\d+\.\d{2}$/);
          expect(new D(b.subtotalBase).add(new D(b.vatBase)).toFixed(2)).toBe(b.totalBase);
          const round = (d: InstanceType<typeof D>) =>
            d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
          expect(b.subtotalBase).toBe(round(new D(t.net).mul(new D(r))));
          expect(b.vatBase).toBe(round(new D(t.vat).mul(new D(r))));
          const direct = new D(t.total).mul(new D(r));
          expect(new D(b.totalBase).sub(direct).abs().lte(new D("0.01"))).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
