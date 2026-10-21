import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { mockMarkReviewed, mockRefresh, mockPush, mockToast } = vi.hoisted(() => ({
  mockMarkReviewed: vi.fn(),
  mockRefresh: vi.fn(),
  mockPush: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: unknown) => ({
    executeAsync: action as (input: unknown) => Promise<unknown>,
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/modules/documents/documents.actions", () => ({
  markDocumentReviewedAction: mockMarkReviewed,
}));
// the modules' dialogs are stubs here: what matters is that they open with the right `initial`
vi.mock("@/modules/expenses/ui", () => ({
  NewExpenseDialog: ({ open, initial }: { open: boolean; initial?: unknown }) =>
    open ? <div data-testid="expense-dialog">{JSON.stringify(initial)}</div> : null,
}));
vi.mock("@/modules/supplier-invoices/ui", () => ({
  NewSupplierInvoiceDialog: ({ open, initial }: { open: boolean; initial?: unknown }) =>
    open ? <div data-testid="si-dialog">{JSON.stringify(initial)}</div> : null,
}));

import { initialFromFacts, MakeItSection } from "./make-it-section";

const options = {
  expense: { groups: [], categories: [], sources: [] },
  supplier: { groups: [], categories: [], suppliers: [], registrations: [] },
};
const facts = {
  vendorName: "SBB CFF FFS",
  vendorTaxId: "CHE-123.456.789",
  invoiceNumber: "9160",
  invoiceDate: "2026-03-04",
  dueDate: "2026-04-03",
  invoiceTotal: 85,
  subtotal: 78.56,
  totalTax: 6.44,
  currency: "chf",
  confidence: 0.9,
  modelUsed: "prebuilt-invoice",
  pageCount: 1,
  processingTimeMs: 10,
};

describe("MakeItSection (specs/documents US1)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("maps the OCR facts as corrected to both dialogs' initial values", () => {
    const i = initialFromFacts("doc-1", "exp_20260304_001", facts);
    expect(i.expense).toEqual({
      date: "2026-03-04",
      description: "SBB CFF FFS",
      amount: "85.00",
      currency: "CHF",
      vatAmount: "6.44",
      documentId: "doc-1",
      documentKey: "exp_20260304_001",
    });
    expect(i.supplier).toMatchObject({
      vendor: { name: "SBB CFF FFS", vatNumber: "CHE-123.456.789" },
      invoiceNumber: "9160",
      invoiceDate: "2026-03-04",
      dueDate: "2026-04-03",
      amountNet: "78.56",
      vatAmount: "6.44",
      amountTotal: "85.00",
    });
    // a merchant receipt: the transaction date, the merchant as the description, no number
    const r = initialFromFacts("doc-2", "exp_x", {
      merchantName: "Coop",
      transactionDate: "2026-03-05T10:00:00",
      invoiceTotal: 12.5,
      confidence: 0.5,
      modelUsed: "prebuilt-receipt",
      pageCount: 1,
      processingTimeMs: 1,
    });
    expect(r.expense).toMatchObject({ date: "2026-03-05", description: "Coop", amount: "12.50" });
    expect(r.supplier.invoiceNumber).toBeNull();
  });

  it("offers the three ways and opens the expense dialog pre-filled", () => {
    render(
      <MakeItSection
        documentId="doc-1"
        documentKey="exp_20260304_001"
        facts={facts}
        reviewedAt={null}
        became={null}
        options={options}
      />,
    );
    expect(screen.getByTestId("make-it-expense")).toBeInTheDocument();
    expect(screen.getByTestId("make-it-supplier-invoice")).toBeInTheDocument();
    expect(screen.getByTestId("make-it-file")).toBeEnabled();
    fireEvent.click(screen.getByTestId("make-it-expense"));
    expect(screen.getByTestId("expense-dialog")).toHaveTextContent('"amount":"85.00"');
    expect(screen.getByTestId("expense-dialog")).toHaveTextContent('"documentId":"doc-1"');
  });

  it("Just file it marks the document reviewed and refreshes", async () => {
    mockMarkReviewed.mockResolvedValue({ data: { data: { reviewedAt: new Date() } } });
    render(
      <MakeItSection
        documentId="doc-1"
        documentKey="k"
        facts={facts}
        reviewedAt={null}
        became={null}
        options={options}
      />,
    );
    fireEvent.click(screen.getByTestId("make-it-file"));
    await vi.waitFor(() => expect(mockMarkReviewed).toHaveBeenCalledWith({ documentId: "doc-1" }));
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("a document that became something shows what, with no buttons", () => {
    render(
      <MakeItSection
        documentId="doc-1"
        documentKey="k"
        facts={facts}
        reviewedAt={null}
        became={{ type: "expense", id: "e-1", label: "Ex213-Tr-04" }}
        options={options}
      />,
    );
    expect(screen.getByTestId("document-became")).toHaveTextContent("Became expense Ex213-Tr-04");
    expect(screen.queryByTestId("make-it-expense")).not.toBeInTheDocument();
  });

  it("renders nothing without options (the accountant, a generated PDF)", () => {
    const { container } = render(
      <MakeItSection
        documentId="doc-1"
        documentKey="k"
        facts={facts}
        reviewedAt={null}
        became={null}
        options={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
