// The mapping from Azure DI's answer to the app's facts, on stored responses of the real shape (2024-11-30 API) with
// invented values (D51) — the mock's own fixture hid that the currency was never read (lessons, 2026-10-24).

import type { AnalyzeOperationOutput } from "@azure-rest/ai-document-intelligence";
import { describe, expect, it } from "vitest";
import invoice from "./__fixtures__/azure-invoice-usd.json";
import receipt from "./__fixtures__/azure-receipt-chf.json";
import { extractTaxRate, mapAnalyzeResult, mentionsReverseCharge } from "./ocr";

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
