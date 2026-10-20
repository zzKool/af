import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  creditNoteNumber,
  creditNoteSeries,
  expenseDocumentKey,
  expenseGroupSeries,
  expenseRef,
  formatSeriesNumber,
  invoiceNumber,
  invoicePdfKey,
  invoiceSeries,
  isUploadKind,
  quoteNumber,
  UPLOAD_KIND_PREFIX,
  uploadDocumentKey,
  uploadSeries,
  yy,
} from "./keys";

describe("fixed key functions (D5, D6) — the Excel conventions", () => {
  it("invoice: {short code}{yy}-{nnn}", () => {
    expect(invoiceSeries("VA", "2026-10-20")).toBe("VA26");
    expect(invoiceNumber("VA", "2026-10-20", 1)).toBe("VA26-001");
    expect(invoiceNumber("VA", "2026-10-20", 42)).toBe("VA26-042");
    expect(invoiceNumber("XYY", "2026-01-05", 2)).toBe("XYY26-002");
  });

  it("quote and credit note series", () => {
    expect(quoteNumber("2026-03-01", 7)).toBe("QUO26-007");
    expect(creditNoteSeries("VA", "2027-02-02")).toBe("CN-VA27");
    expect(creditNoteNumber("VA", "2027-02-02", 1)).toBe("CN-VA27-001");
  });

  it("invoice PDF document key", () => {
    expect(invoicePdfKey("VA26-001")).toBe("InvoiceAF_VA26-001.pdf");
    expect(invoicePdfKey("CN-VA27-001")).toBe("InvoiceAF_CN-VA27-001.pdf");
    expect(() => invoicePdfKey("draft")).toThrow();
  });

  it("expense ref and receipt key", () => {
    expect(expenseRef(213, "Tr", 1)).toBe("Ex213-Tr-01");
    expect(expenseRef(233, "Tr", 2)).toBe("Ex233-Tr-02");
    expect(expenseDocumentKey("Ex213-Tr-01", "2026-03-11")).toBe("Ex213-Tr-01_2026-03-11_");
    expect(expenseGroupSeries(213)).toBe("exg-213");
    expect(() => expenseDocumentKey("213-Tr-01", "2026-03-11")).toThrow();
  });

  it("provisional upload key keeps v2's prefixes", () => {
    expect(uploadDocumentKey("expense", "2026-10-20", 1)).toBe("exp_20261020_001");
    expect(uploadDocumentKey("contract", "2026-10-20", 12)).toBe("ctrt_20261020_012");
    expect(uploadSeries("2026-10-20")).toBe("doc-2026-10");
    expect(isUploadKind("nda")).toBe(true);
    expect(isUploadKind("receipt")).toBe(false);
    expect(Object.values(UPLOAD_KIND_PREFIX)).toEqual(["exp_", "inv_", "ctrt_", "nda_", "cert_"]);
  });

  it("validates its inputs instead of producing garbage keys", () => {
    expect(() => yy("20261020")).toThrow(/ISO date/);
    expect(() => invoiceSeries("va", "2026-10-20")).toThrow(/short code/);
    expect(() => formatSeriesNumber("VA26", 0)).toThrow(/positive/);
    expect(() => expenseRef(213, "Tr-1", 1)).toThrow(/alias/);
  });

  it("property: sequences keep order and never collide within a series", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (a, b) => {
          const na = formatSeriesNumber("VA26", a);
          const nb = formatSeriesNumber("VA26", b);
          if (a === b) return na === nb;
          // distinct sequences → distinct numbers; both parse back to their sequence
          return na !== nb && Number(na.slice(5)) === a && Number(nb.slice(5)) === b;
        },
      ),
    );
  });

  it("property: three-digit padding up to 999, then it just grows", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), (n) => {
        return formatSeriesNumber("S", n).length === "S-".length + 3;
      }),
    );
    expect(formatSeriesNumber("S", 1000)).toBe("S-1000");
  });
});
