// The mock OCR's readings (F108: runs only when `OCR_PROVIDER=mock`), as stored Document Intelligence responses of
// the real shape (2024-11-30 API) with invented values — `createMockOcrService` picks one **by the model
// `ocrModelFor` chose** (`mockResponseFor`) and runs it through `mapAnalyzeResult` like the real service does, so
// the mock can never return a shape the mapper does not produce (F127) nor a model the kernel would not pick. The typed
// values are the ones the tests and the e2e journeys have always seen (Test Vendor AB · 1 250.00 · INV-2026-001;
// ICA Maxi · 342.50); the fields beside them are what the prebuilt models return and the mapper does not type —
// they show under *Also read*.

type Field = Record<string, unknown>;

const str = (value: string, confidence: number, content = value): Field => ({
  type: "string",
  valueString: value,
  content,
  confidence,
});
const date = (value: string, confidence: number, content = value): Field => ({
  type: "date",
  valueDate: value,
  content,
  confidence,
});
const num = (value: number, confidence: number, content = String(value)): Field => ({
  type: "number",
  valueNumber: value,
  content,
  confidence,
});
const sek = (amount: number, confidence: number, content: string): Field => ({
  type: "currency",
  valueCurrency: { amount, currencyCode: "SEK", currencySymbol: "kr" },
  content,
  confidence,
});
const obj = (valueObject: Record<string, Field>): Field => ({ type: "object", valueObject });
const arr = (valueArray: Field[]): Field => ({ type: "array", valueArray });

export type MockResponse = {
  modelId: string;
  processingTimeMs: number;
  /** the `analyzeResult` of a DI operation, as the poller hands it back */
  analyzeResult: Record<string, unknown>;
};

const invoice: MockResponse = {
  modelId: "prebuilt-invoice",
  processingTimeMs: 1200,
  analyzeResult: {
    apiVersion: "2024-11-30",
    modelId: "prebuilt-invoice",
    content: "Invoice from Test Vendor AB...",
    pages: [{ pageNumber: 1 }],
    documents: [
      {
        docType: "invoice",
        confidence: 0.95,
        fields: {
          VendorName: str("Test Vendor AB", 0.97),
          VendorAddressRecipient: str("Test Vendor AB", 0.91),
          VendorAddress: {
            type: "address",
            valueAddress: {
              streetAddress: "Storgatan 1",
              postalCode: "111 22",
              city: "Stockholm",
              countryRegion: "SE",
            },
            content: "Storgatan 1\n111 22 Stockholm\nSweden",
            confidence: 0.93,
          },
          VendorTaxId: str("SE556677889901", 0.95),
          CustomerName: str("Dev AB", 0.96),
          CustomerAddress: {
            type: "address",
            valueAddress: {
              streetAddress: "Kungsgatan 10",
              postalCode: "411 19",
              city: "Göteborg",
              countryRegion: "SE",
            },
            content: "Kungsgatan 10\n411 19 Göteborg\nSweden",
            confidence: 0.88,
          },
          InvoiceId: str("INV-2026-001", 0.81),
          InvoiceDate: date("2026-03-14", 0.99, "14 March 2026"),
          PurchaseOrder: str("PO-7731", 0.64),
          PaymentTerm: str("30 days net", 0.9),
          SubTotal: sek(1000, 0.97, "1 000,00"),
          TotalTax: sek(250, 0.97, "250,00"),
          InvoiceTotal: sek(1250, 0.98, "1 250,00 SEK"),
          AmountDue: sek(1250, 0.96, "1 250,00 SEK"),
          PaymentDetails: arr([
            obj({
              IBAN: str("SE1234567890123456", 0.95),
              SWIFT: str("NDEASESS", 0.95),
            }),
          ]),
          TaxDetails: arr([
            obj({
              Amount: sek(250, 0.92, "250,00"),
              Rate: str("25%", 0.92),
            }),
          ]),
          Items: arr([
            obj({
              Description: str("Consulting", 0.95),
              Quantity: num(10, 0.94),
              UnitPrice: sek(100, 0.96, "100,00"),
              Amount: sek(1000, 0.96, "1 000,00"),
            }),
          ]),
        },
      },
    ],
  },
};

const receipt: MockResponse = {
  modelId: "prebuilt-receipt",
  processingTimeMs: 800,
  analyzeResult: {
    apiVersion: "2024-11-30",
    modelId: "prebuilt-receipt",
    content: "ICA Maxi Kvitto...",
    pages: [{ pageNumber: 1 }],
    documents: [
      {
        docType: "receipt.retailMeal",
        confidence: 0.92,
        fields: {
          MerchantName: str("ICA Maxi", 0.97),
          MerchantAddress: {
            type: "address",
            valueAddress: {
              road: "Marknadsgatan",
              houseNumber: "3",
              postalCode: "754 60",
              city: "Uppsala",
              countryRegion: "SE",
            },
            content: "Marknadsgatan 3\n754 60 Uppsala",
            confidence: 0.85,
          },
          MerchantPhoneNumber: {
            type: "phoneNumber",
            valuePhoneNumber: "+4618123456",
            content: "018-12 34 56",
            confidence: 0.78,
          },
          ReceiptType: str("Supplies", 0.9),
          TransactionDate: date("2026-03-14", 0.98, "2026-03-14"),
          TransactionTime: {
            type: "time",
            valueTime: "17:42:00",
            content: "17:42",
            confidence: 0.93,
          },
          Subtotal: sek(274, 0.95, "274,00"),
          TotalTax: sek(68.5, 0.95, "68,50"),
          Total: sek(342.5, 0.98, "342,50"),
          TaxDetails: arr([
            obj({
              Amount: sek(68.5, 0.9, "68,50"),
              Rate: str("25%", 0.9),
            }),
          ]),
          Items: arr([
            obj({
              Description: str("Groceries", 0.93),
              TotalPrice: sek(342.5, 0.96, "342,50"),
            }),
          ]),
        },
      },
    ],
  },
};

const layout = (content: string): MockResponse => ({
  modelId: "prebuilt-layout",
  processingTimeMs: 600,
  analyzeResult: {
    apiVersion: "2024-11-30",
    modelId: "prebuilt-layout",
    content,
    pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
  },
});

/** One stored response per prefix type; an unknown type gets the contract's (a layout reading). */
export const MOCK_RESPONSES: Record<string, MockResponse> = {
  invoice,
  expense: receipt,
  contract: layout("Service Agreement between..."),
  nda: layout("Non-Disclosure Agreement..."),
  certificate: layout("Certificate of Incorporation..."),
};

/**
 * The stored response **by the model** `ocrModelFor` picked — the mock answers like the real service does (D69: an
 * `expense` PDF is read by the invoice model; D75: the paper answer on a bank row picks the model whatever the
 * file), never by the type alone (lessons *F131 build*). A layout reading keeps its type's text; an unknown type
 * gets the contract's.
 */
export function mockResponseFor(prefixType: string, modelId: string): MockResponse {
  if (modelId === "prebuilt-invoice") return invoice;
  if (modelId === "prebuilt-receipt") return receipt;
  const byType = MOCK_RESPONSES[prefixType];
  return byType?.modelId === "prebuilt-layout" ? byType : MOCK_RESPONSES.contract;
}
