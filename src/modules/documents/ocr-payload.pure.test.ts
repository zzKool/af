// The corrections contract (lessons audit 11, F61): strict on write, per field on read — a stored value that
// does not fit is dropped so one bad row never breaks a list; and the currency is one the app knows or none.
import { describe, expect, it } from "vitest";
import {
  amountText,
  correctionsPatchSchema,
  knownCurrency,
  ocrPayloadToJson,
  parseCorrections,
  parseOcrFields,
  parseOcrPayload,
  resolveDocumentData,
} from "./ocr-payload";

describe("correctionsPatchSchema (write)", () => {
  it("accepts what the review page sends", () => {
    const patch = {
      vendorName: "SBB",
      invoiceTotal: 120.5,
      currency: "CHF",
      transactionDate: "2026-03-10",
      dueDate: "",
      items: [{ description: "Ticket", amount: 120.5 }],
    };
    expect(correctionsPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("refuses a null amount, an unknown currency, a bad date and a field it does not know", () => {
    for (const bad of [
      { invoiceTotal: null },
      { invoiceTotal: "120.50" },
      { currency: "GBP" },
      { invoiceDate: "10.03.2026" },
      { status: "linked" },
      { items: [{ amount: null }] },
    ]) {
      expect(correctionsPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("parseCorrections (read)", () => {
  it("keeps the fields that fit and drops the rest, never throws", () => {
    const stored = {
      invoiceTotal: null,
      currency: 42,
      vendorName: "OpenAI Ireland",
      junk: { a: 1 },
    };
    expect(parseCorrections(stored)).toEqual({ vendorName: "OpenAI Ireland" });
  });

  it("a non-object column is no corrections", () => {
    for (const v of [null, "x", 3, [1]]) expect(parseCorrections(v)).toBeNull();
  });

  it("a dropped correction falls back to the OCR value", () => {
    const merged = resolveDocumentData(
      {
        invoiceTotal: 20,
        currency: "USD",
        confidence: 1,
        modelUsed: "m",
        pageCount: 1,
        processingTimeMs: 1,
      },
      parseCorrections({ invoiceTotal: null }),
    );
    expect(amountText(merged.invoiceTotal)).toBe("20.00");
  });
});

describe("amountText / knownCurrency", () => {
  it("an amount only when it is a finite number", () => {
    expect(amountText(12.5)).toBe("12.50");
    for (const v of [undefined, null, "12.5", Number.NaN]) expect(amountText(v)).toBeNull();
  });

  it("a currency only when the app knows it, case-insensitively", () => {
    expect(knownCurrency("chf")).toBe("CHF");
    expect(knownCurrency(" EUR ")).toBe("EUR");
    for (const v of [undefined, null, "", "GBP", 42]) expect(knownCurrency(v)).toBeNull();
  });
});

describe("ocrPayloadToJson (the OCR job's write, F50-f)", () => {
  it("round-trips through parseOcrPayload; undefined fields are dropped like the column would", () => {
    const json = ocrPayloadToJson({
      extractedData: {
        vendorName: "SBB",
        invoiceTotal: 120.5,
        currency: "CHF",
        merchantName: undefined,
        confidence: 0.9,
        modelUsed: "prebuilt-receipt",
        pageCount: 1,
        processingTimeMs: 10,
      },
      rawResponse: { analyzeResult: { documents: [] } },
      quality: "high",
    });
    expect(json).toEqual({
      extractedData: {
        vendorName: "SBB",
        invoiceTotal: 120.5,
        currency: "CHF",
        confidence: 0.9,
        modelUsed: "prebuilt-receipt",
        pageCount: 1,
        processingTimeMs: 10,
      },
      rawResponse: { analyzeResult: { documents: [] } },
      quality: "high",
    });
    // F127: a payload without `fields` (written before F127) reads back with `fields: {}` — the old reading
    expect(parseOcrPayload(json as Parameters<typeof parseOcrPayload>[0])).toEqual({
      extractedData: { ...(json.extractedData as object), fields: {} },
      quality: "high",
    });
  });

  // F127: every DI field with its confidence rides in `extractedData.fields`, arrays as arrays
  it("round-trips `fields` — a scalar, a currency, an array of maps — as the mapper built them", () => {
    const fields = {
      InvoiceId: {
        type: "string",
        value: "NW-2026-0042",
        confidence: 0.81,
        content: "NW-2026-0042",
      },
      InvoiceTotal: {
        type: "currency",
        value: { amount: 49, currencyCode: "USD" },
        confidence: 0.96,
        content: "$49.00",
      },
      PaymentTerm: { type: "string", value: null, confidence: null, content: "net 30" },
      Items: {
        type: "array",
        value: [
          {
            type: "object",
            value: {
              Description: {
                type: "string",
                value: "Cloud plan",
                confidence: 0.94,
                content: "Cloud\nplan",
              },
              Amount: {
                type: "currency",
                value: { amount: 49, currencyCode: "USD" },
                confidence: 0.96,
                content: "49",
              },
            },
            confidence: null,
            content: null,
          },
        ],
        confidence: null,
        content: null,
      },
    };
    const json = ocrPayloadToJson({
      extractedData: {
        vendorName: "Northwind",
        fields,
        confidence: 1,
        modelUsed: "prebuilt-invoice",
        pageCount: 1,
        processingTimeMs: 10,
      },
      rawResponse: {},
      quality: "high",
    });
    const read = parseOcrPayload(json as Parameters<typeof parseOcrPayload>[0]);
    expect(read?.extractedData?.fields).toEqual(fields);
    expect(Array.isArray(read?.extractedData?.fields?.Items.value)).toBe(true);
  });

  it("drops a `fields` entry that is not a field and a `fields` that is not a map, never throws", () => {
    expect(parseOcrFields(undefined)).toEqual({});
    expect(parseOcrFields(null)).toEqual({});
    expect(parseOcrFields("VendorName")).toEqual({});
    expect(parseOcrFields([{ type: "string", value: "x" }])).toEqual({});
    expect(
      parseOcrFields({
        VendorName: { type: "string", value: "Northwind", confidence: "0.9", content: 12 },
        Junk: "Northwind",
        NoType: { value: "x", confidence: 0.9, content: "x" },
        NoValue: { type: "string", confidence: 0.9, content: "x" },
      }),
    ).toEqual({
      // a confidence that is not a number and a content that is not a string read as "none"
      VendorName: { type: "string", value: "Northwind", confidence: null, content: null },
    });
  });
});
