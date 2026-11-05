// The mapping from Azure DI's answer to the app's facts, on stored responses of the real shape (2024-11-30 API) with
// invented values (D51) — the mock's own fixture hid that the currency was never read (lessons, 2026-10-24).

import type { AnalyzeOperationOutput } from "@azure-rest/ai-document-intelligence";
import { describe, expect, it } from "vitest";
import invoiceSek from "./__fixtures__/azure-invoice-sek.json";
import invoice from "./__fixtures__/azure-invoice-usd.json";
import receipt from "./__fixtures__/azure-receipt-chf.json";
import { MOCK_RESPONSES } from "./__fixtures__/mock-responses";
import { alsoReadFields, fieldConfidence, fieldEntries, fieldText, type OcrField } from "./fields";
import {
  createMockOcrService,
  extractTaxRate,
  mapAnalyzeResult,
  mentionsReverseCharge,
} from "./ocr";

type AnalyzeResult = AnalyzeOperationOutput["analyzeResult"];
const asResult = (json: unknown) => json as AnalyzeResult;

describe("mapAnalyzeResult — an invoice", () => {
  const { data, quality } = mapAnalyzeResult(asResult(invoice), "prebuilt-invoice", 1000);

  it("takes the currency from the amounts (there is no document-level currency field)", () => {
    expect(data.currency).toBe("USD");
  });

  it("reads the invoice facts", () => {
    expect(data).toMatchObject({
      vendorName: "Northwind Cloud Inc.",
      vendorTaxId: "EU999000111",
      invoiceNumber: "NW-2026-0042",
      invoiceDate: "2026-03-14",
      invoiceTotal: 49,
      subtotal: 49,
    });
    expect(quality).toBe("high");
  });

  it("folds a line's printed line break into a space and reads the tax rate", () => {
    expect(data.items).toEqual([
      {
        description: "Cloud plan (per seat) Mar 14-Apr 14, 2026",
        quantity: 1,
        unitPrice: 49,
        amount: 49,
        taxRate: 0,
      },
    ]);
  });

  it("reads who it is billed to and that the buyer pays the VAT", () => {
    expect(data.customerName).toBe("Dev AB");
    expect(data.customerTaxId).toBe("SE556677889901");
    expect(data.reverseCharge).toBe(true);
  });

  it("takes the vendor's name from its address block when the logo line was not read as a name", () => {
    const bare = structuredClone(invoice) as { documents: { fields: Record<string, unknown> }[] };
    const fields = bare.documents[0].fields;
    delete fields.VendorName;
    fields.VendorAddressRecipient = {
      type: "string",
      valueString: "Northwind Cloud AB",
      content: "Northwind  Cloud AB",
      confidence: 0.9,
    };
    expect(mapAnalyzeResult(asResult(bare), "prebuilt-invoice", 1).data.vendorName).toBe(
      "Northwind Cloud AB",
    );
  });

  it("leaves the currency unknown when no amount carries a code — never a guess", () => {
    const bare = structuredClone(invoice) as { documents: { fields: Record<string, unknown> }[] };
    const fields = bare.documents[0].fields;
    for (const key of ["InvoiceTotal", "SubTotal", "AmountDue"]) {
      fields[key] = { type: "number", valueNumber: 49 };
    }
    delete fields.Items;
    expect(mapAnalyzeResult(asResult(bare), "prebuilt-invoice", 1).data.currency).toBeUndefined();
  });
});

describe("mapAnalyzeResult — a receipt", () => {
  const { data } = mapAnalyzeResult(asResult(receipt), "prebuilt-receipt", 1000);

  it("takes the currency from the total (receipts had none before)", () => {
    expect(data.currency).toBe("CHF");
  });

  it("reads the merchant, the day, the total and the VAT; no invoice-only facts", () => {
    expect(data).toMatchObject({
      merchantName: "Café Exemple",
      transactionDate: "2026-03-15",
      invoiceTotal: 18.5,
      totalTax: 1.4,
    });
    expect(data.invoiceNumber).toBeUndefined();
    expect(data.customerName).toBeUndefined();
    expect(data.reverseCharge).toBeUndefined();
  });

  it("reads a receipt line's unit price from Price", () => {
    expect(data.items?.[0]).toMatchObject({
      description: "Espresso x2",
      unitPrice: 4.5,
      amount: 9,
    });
  });
});

describe("extractTaxRate", () => {
  it.each([
    [{ type: "string", valueString: "25%" }, 25],
    [{ type: "string", valueString: "0%[1]" }, 0],
    [{ type: "string", valueString: "7,7 %" }, 7.7],
    [{ type: "number", valueNumber: 0.25 }, 25],
    [{ type: "number", valueNumber: 8.1 }, 8.1],
    [{ type: "string", valueString: "exempt" }, undefined],
    [undefined, undefined],
  ])("%j → %s", (field, expected) => {
    expect(extractTaxRate(field as never)).toBe(expected);
  });
});

describe("mentionsReverseCharge", () => {
  it.each([
    ["Tax to be paid on reverse charge basis", true],
    ["Reverse-Charge: Steuerschuldnerschaft des Leistungsempfängers", true],
    ["TVA due par le preneur — autoliquidation", true],
    ["Omvänd skattskyldighet", true],
    ["Total incl. VAT 8.1%", false],
    [undefined, false],
  ])("%s → %s", (text, expected) => {
    expect(mentionsReverseCharge(text)).toBe(expected);
  });
});

// --- F127: every field with its confidence (review 2026-10-31 §3) ---

describe("mapAnalyzeResult — `fields` keeps every field DI returned", () => {
  const fixtureFields = (invoiceSek as { documents: { fields: Record<string, unknown> }[] })
    .documents[0].fields;
  const { data } = mapAnalyzeResult(asResult(invoiceSek), "prebuilt-invoice", 1000);
  const fields = data.fields ?? {};

  it("one entry per DI field, in DI's order, nothing added", () => {
    expect(Object.keys(fields)).toEqual(Object.keys(fixtureFields));
  });

  it("normalises the value by DI's type: string, date, currency, address — and null when DI resolved none", () => {
    expect(fields.InvoiceId).toEqual({
      type: "string",
      value: "2026-071",
      confidence: 0.81,
      content: "2026-071",
    });
    expect(fields.DueDate.value).toBe("2026-08-05");
    expect(fields.InvoiceTotal).toEqual({
      type: "currency",
      value: { amount: 1597.2, currencyCode: "SEK" },
      confidence: 0.99,
      content: "1 597,20 SEK",
    });
    expect(fields.VendorAddress.value).toEqual({
      street: "Storgatan 12",
      postalCode: "111 51",
      city: "Stockholm",
      text: "Storgatan 12, 111 51 Stockholm",
    });
    // read but not resolved: the printed text stays, the value is null, the (low) confidence too
    expect(fields.ServiceStartDate).toEqual({
      type: "date",
      value: null,
      confidence: 0.41,
      content: "juli 2026",
    });
  });

  it("keeps the arrays as arrays — never flattened — with their entries' fields and confidences", () => {
    expect(fields.Items.type).toBe("array");
    expect(fields.Items.confidence).toBeNull();
    const items = fields.Items.value as OcrField[];
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("object");
    const first = items[0].value as Record<string, OcrField>;
    expect(first.Description).toEqual({
      type: "string",
      value: "Kontorsstädning\njuli 2026",
      confidence: 0.93,
      content: "Kontorsstädning\njuli 2026",
    });
    expect(first.Unit.value).toBe("st"); // a child the line-items mapping does not type
    expect(fieldEntries(fields.TaxDetails)).toHaveLength(1);
    expect(fieldEntries(fields.PaymentDetails).map(([name]) => name)).toEqual(["1"]);
  });

  it("the typed subset is read as before, from the same map", () => {
    expect(data).toMatchObject({
      vendorName: "Skattepunkten Office Services AB",
      vendorTaxId: "SE559911223301",
      invoiceNumber: "2026-071",
      invoiceDate: "2026-07-06",
      dueDate: "2026-08-05",
      invoiceTotal: 1597.2,
      subtotal: 1277.76,
      totalTax: 319.44,
      currency: "SEK",
      customerName: "Dev AB",
      paymentDetails: [{ iban: "SE4550000000058398257466", swift: "ESSESESS" }],
    });
    expect(data.items).toHaveLength(2);
    expect(data.items?.[1]).toMatchObject({ description: "Fönsterputs", quantity: 2, amount: 240 });
  });

  it("fieldConfidence: DI's confidence of the field a typed key was read from", () => {
    expect(fieldConfidence(data, "invoiceNumber")).toBe(0.81);
    expect(fieldConfidence(data, "vendorName")).toBe(0.94);
    expect(fieldConfidence(data, "invoiceTotal")).toBe(0.99);
    expect(fieldConfidence(data, "subtotal")).toBe(0.96);
    expect(fieldConfidence(data, "customerTaxId")).toBeNull(); // not on this invoice
    expect(fieldConfidence(data, "merchantName")).toBeNull(); // a receipt's key, never on an invoice
  });

  it("fieldConfidence follows the mapper's fallback: VendorAddressRecipient when VendorName was not read", () => {
    const bare = structuredClone(invoiceSek) as {
      documents: { fields: Record<string, unknown> }[];
    };
    delete bare.documents[0].fields.VendorName;
    bare.documents[0].fields.VendorAddressRecipient = {
      type: "string",
      valueString: "Skattepunkten Office Services AB",
      content: "Skattepunkten Office Services AB",
      confidence: 0.77,
    };
    const fallback = mapAnalyzeResult(asResult(bare), "prebuilt-invoice", 1).data;
    expect(fallback.vendorName).toBe("Skattepunkten Office Services AB");
    expect(fieldConfidence(fallback, "vendorName")).toBe(0.77);
  });

  it("fieldConfidence is null on a reading without `fields` (a document read before F127)", () => {
    expect(fieldConfidence({ modelUsed: "prebuilt-invoice" }, "vendorName")).toBeNull();
    expect(fieldConfidence(null, "vendorName")).toBeNull();
  });

  it("alsoReadFields: the scalars the mapper does not type, then every array — never a typed scalar", () => {
    const names = alsoReadFields(data).map(([name]) => name);
    // the scalars first, then the lists, each by name — JSONB does not keep DI's order
    expect(names).toEqual([
      "AmountDue",
      "CustomerAddress",
      "PaymentTerm",
      "PurchaseOrder",
      "ServiceStartDate",
      "Items",
      "PaymentDetails",
      "TaxDetails",
    ]);
    for (const typed of ["VendorName", "InvoiceId", "InvoiceTotal", "SubTotal", "DueDate"]) {
      expect(names).not.toContain(typed);
    }
    expect(alsoReadFields({ modelUsed: "prebuilt-invoice" })).toEqual([]);
  });

  it("fieldText: the printed text folded to one line, else the value spelt out", () => {
    expect(fieldText(fields.AmountDue)).toBe("1 597,20 SEK");
    expect(fieldText(fields.CustomerAddress)).toBe("Kungsgatan 10 411 19 Göteborg");
    expect(
      fieldText({
        type: "currency",
        value: { amount: 12, currencyCode: "EUR" },
        confidence: null,
        content: null,
      }),
    ).toBe("12 EUR");
    expect(fieldText({ type: "string", value: null, confidence: null, content: null })).toBe("");
  });
});

describe("mapAnalyzeResult — a receipt's `fields` (the receipt model types fewer)", () => {
  const { data } = mapAnalyzeResult(asResult(receipt), "prebuilt-receipt", 1000);

  it("invoiceTotal's confidence is Total's; merchantName's is MerchantName's", () => {
    expect(fieldConfidence(data, "invoiceTotal")).toBe(0.96);
    expect(fieldConfidence(data, "merchantName")).toBe(0.94);
    expect(fieldConfidence(data, "vendorName")).toBeNull();
  });

  it("Also read on a receipt: the arrays only, here — every scalar of this fixture is typed", () => {
    expect(alsoReadFields(data).map(([name]) => name)).toEqual(["Items"]);
  });
});

describe("the mock OCR — a stored response through the same mapper", () => {
  const mock = createMockOcrService();
  const source = { type: "buffer" as const, buffer: Buffer.from("x"), mimeType: "application/pdf" };
  // the mock answers by the model the kernel picks: an expense is read as a receipt when it is an image (D69)
  const photo = { type: "buffer" as const, buffer: Buffer.from("x"), mimeType: "image/jpeg" };

  it.each(["invoice", "expense"])(
    "%s: `fields` of the real shape, every typed value with a confidence",
    async (type) => {
      const result = await mock.analyzeDocument(type === "expense" ? photo : source, type);
      if (!result.success) throw new Error("mock failed");
      const { data } = result;
      expect(data.fields).toBeDefined();
      const typedKeys =
        type === "invoice"
          ? ([
              "vendorName",
              "vendorTaxId",
              "invoiceNumber",
              "invoiceDate",
              "invoiceTotal",
              "subtotal",
              "totalTax",
              "customerName",
            ] as const)
          : (["merchantName", "transactionDate", "invoiceTotal", "subtotal", "totalTax"] as const);
      for (const key of typedKeys) {
        expect(data[key], key).toBeDefined();
        expect(fieldConfidence(data, key), key).toBeGreaterThan(0);
      }
      // something for *Also read*, so the e2e and the screenshots show the section
      expect(alsoReadFields(data).length).toBeGreaterThan(0);
    },
  );

  it("keeps the readings the journeys rely on", async () => {
    const invoiceRead = await mock.analyzeDocument(source, "invoice");
    const receiptRead = await mock.analyzeDocument(photo, "expense");
    if (!invoiceRead.success || !receiptRead.success) throw new Error("mock failed");
    expect(invoiceRead.data).toMatchObject({
      vendorName: "Test Vendor AB",
      vendorTaxId: "SE556677889901",
      vendorAddress: {
        street: "Storgatan 1",
        postalCode: "111 22",
        city: "Stockholm",
        country: "SE",
        text: "Storgatan 1, 111 22 Stockholm, Sweden",
      },
      invoiceTotal: 1250,
      subtotal: 1000,
      totalTax: 250,
      invoiceDate: "2026-03-14",
      currency: "SEK",
      invoiceNumber: "INV-2026-001",
      customerName: "Dev AB",
      paymentDetails: [{ iban: "SE1234567890123456", swift: "NDEASESS" }],
      confidence: 0.95,
      modelUsed: "prebuilt-invoice",
      pageCount: 1,
    });
    expect(invoiceRead.data.items).toEqual([
      { description: "Consulting", quantity: 10, unitPrice: 100, amount: 1000 },
    ]);
    expect(invoiceRead.quality).toBe("high");
    expect(receiptRead.data).toMatchObject({
      merchantName: "ICA Maxi",
      invoiceTotal: 342.5,
      subtotal: 274,
      totalTax: 68.5,
      transactionDate: "2026-03-14",
      currency: "SEK",
      confidence: 0.92,
      modelUsed: "prebuilt-receipt",
    });
    expect(receiptRead.data.items).toEqual([{ description: "Groceries", amount: 342.5 }]);
    expect(receiptRead.quality).toBe("high");
  });

  it("its rawResponse is the DI-shaped response the data came from", async () => {
    const result = await mock.analyzeDocument(source, "invoice");
    if (!result.success) throw new Error("mock failed");
    const again = mapAnalyzeResult(asResult(result.rawResponse), "prebuilt-invoice", 1200);
    expect(again.data).toEqual(result.data);
    expect(Object.keys(MOCK_RESPONSES)).toEqual([
      "invoice",
      "expense",
      "contract",
      "nda",
      "certificate",
    ]);
  });

  it("a layout reading has no `fields`", async () => {
    const result = await mock.analyzeDocument(source, "contract");
    if (!result.success) throw new Error("mock failed");
    expect(result.data.fields).toBeUndefined();
    expect(result.data.pageCount).toBe(2);
    expect(result.quality).toBe("none");
  });
});
