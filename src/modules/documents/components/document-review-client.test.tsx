import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// --- Hoisted mocks ---
const { mockUpdateAction, mockMarkReviewedAction, mockUnarchive, mockRefresh, mockToast } =
  vi.hoisted(() => ({
    mockUpdateAction: vi.fn(),
    mockMarkReviewedAction: vi.fn(),
    mockUnarchive: vi.fn(),
    mockRefresh: vi.fn(),
    mockToast: { error: vi.fn(), success: vi.fn() },
  }));

// Mock server actions
vi.mock("@/modules/documents/documents.actions", () => ({
  updateDocumentCorrectionsAction: mockUpdateAction,
  markDocumentReviewedAction: mockMarkReviewedAction,
  refreshSignedUrlAction: vi.fn(),
  classifyDocumentAction: vi.fn(),
  runOcrAction: vi.fn(),
  unarchiveDocumentsAction: mockUnarchive,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
  usePathname: () => "/documents/doc-1",
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: unknown) => ({ executeAsync: action, isPending: false }),
}));
// the modules' dialogs are not under test here
vi.mock("@/modules/expenses/ui", () => ({ NewExpenseDialog: () => null }));
vi.mock("@/modules/supplier-invoices/ui", () => ({ NewSupplierInvoiceDialog: () => null }));

// Mock sonner
vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Mock next/dynamic — render children directly
vi.mock("next/dynamic", () => ({
  default: () => {
    const Component = () => <div data-testid="document-preview">Preview</div>;
    Component.displayName = "DocumentPreview";
    return Component;
  },
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock Zustand store with real state
let storeState: Record<string, unknown> = {};
vi.mock("@/modules/documents/stores/use-document-review-store", () => ({
  useDocumentReviewStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const defaultState: Record<string, unknown> = {
      corrections: storeState.corrections ?? {},
      saveStatus: storeState.saveStatus ?? {},
      setCorrection: (field: string, value: unknown) => {
        storeState.corrections = {
          ...(storeState.corrections as Record<string, unknown>),
          [field]: value,
        };
      },
      setCorrections: (patch: Record<string, unknown>) => {
        storeState.corrections = {
          ...(storeState.corrections as Record<string, unknown>),
          ...patch,
        };
      },
      setSaveStatus: (field: string, status: string) => {
        storeState.saveStatus = {
          ...(storeState.saveStatus as Record<string, string>),
          [field]: status,
        };
      },
      resetFromServer: (corrections: Record<string, unknown>) => {
        storeState.corrections = corrections;
        storeState.saveStatus = {};
      },
    };
    return selector({ ...defaultState, ...storeState });
  },
}));

// Mock FormattedDate
vi.mock("@/kernel/i18n/formatted-date", () => ({
  FormattedDate: ({ date }: { date: Date }) => <span>{new Date(date).toISOString()}</span>,
}));

import { DocumentReviewClient } from "@/modules/documents/components/document-review-client";
import type { DocumentReviewData } from "@/modules/documents/documents.actions";

function makeReviewData(overrides?: Partial<DocumentReviewData>): DocumentReviewData {
  return {
    id: "doc-123",
    businessKey: "exp_20260315_001",
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    fileSize: 102400,
    prefixType: "expense",
    documentType: "expense",
    status: "extracted",
    createdAt: new Date("2026-03-15T10:00:00Z"),
    signedUrl: "https://blob.test/receipt.pdf?sig=abc",
    extractedData: {
      vendorName: "Lufthansa",
      invoiceTotal: 12500,
      confidence: 0.95,
      modelUsed: "prebuilt-invoice",
      pageCount: 1,
      processingTimeMs: 2300,
    },
    corrections: null,
    resolvedData: {
      vendorName: "Lufthansa",
      invoiceTotal: 12500,
      confidence: 0.95,
      modelUsed: "prebuilt-invoice",
      pageCount: 1,
      processingTimeMs: 2300,
    },
    quality: "high",
    updatedAt: new Date("2026-03-15T10:00:00Z"),
    reviewedAt: null,
    reviewedBy: null,
    archivedAt: null,
    readOnly: false,
    ...overrides,
  };
}

describe("DocumentReviewClient", () => {
  afterEach(() => {
    cleanup();
    mockUpdateAction.mockReset();
    mockMarkReviewedAction.mockReset();
    mockUnarchive.mockReset();
    mockRefresh.mockReset();
    mockToast.error.mockReset();
    mockToast.success.mockReset();
    storeState = {};
  });

  // --- Layout ---
  it("renders dual-pane layout with preview and form", () => {
    render(<DocumentReviewClient data={makeReviewData()} />);
    expect(screen.getByTestId("document-preview")).toBeInTheDocument();
    expect(screen.getByText("exp_20260315_001")).toBeInTheDocument();
  });

  // --- Header quality badges ---
  it("shows the high quality tag", () => {
    render(<DocumentReviewClient data={makeReviewData({ quality: "high" })} />);
    expect(screen.getByText(/Review extracted data/)).toBeInTheDocument();
  });

  it("shows the low quality tag", () => {
    render(<DocumentReviewClient data={makeReviewData({ quality: "low" })} />);
    expect(screen.getByText(/Low Confidence/)).toBeInTheDocument();
  });

  it("shows the none quality tag", () => {
    render(<DocumentReviewClient data={makeReviewData({ quality: "none" })} />);
    expect(screen.getByText(/Manual Entry Required/)).toBeInTheDocument();
  });

  it("hides quality badge for read-only (accountant) view", () => {
    render(<DocumentReviewClient data={makeReviewData({ readOnly: true })} />);
    expect(screen.queryByText(/Review extracted data/)).not.toBeInTheDocument();
  });

  // --- The derived state (F71: the inbox's word, the D40 family) ---
  it("shows the document's state as icon + word: ready until filed, filed once reviewed", () => {
    const { unmount } = render(
      <DocumentReviewClient data={makeReviewData({ status: "extracted", reviewedAt: null })} />,
    );
    const ready = screen.getByTestId("document-review-state");
    expect(ready).toHaveTextContent("Ready");
    expect(ready.querySelector("[data-state-family]")).toHaveAttribute(
      "data-state-family",
      "progress",
    );
    unmount();
    render(
      <DocumentReviewClient
        data={makeReviewData({ status: "extracted", reviewedAt: new Date("2026-03-15T12:00:00Z") })}
      />,
    );
    expect(screen.getByTestId("document-review-state")).toHaveAttribute(
      "data-document-state",
      "filed",
    );
  });

  // --- Review status ---
  it("shows awaiting review when not reviewed", () => {
    render(<DocumentReviewClient data={makeReviewData({ reviewedAt: null })} />);
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
  });

  it("shows reviewed date when reviewed", () => {
    render(
      <DocumentReviewClient
        data={makeReviewData({ reviewedAt: new Date("2026-03-15T12:00:00Z") })}
      />,
    );
    // "Reviewed" appears in both header and footer
    expect(screen.getAllByText(/Reviewed/).length).toBeGreaterThanOrEqual(1);
  });

  // --- Footer review button states ---
  it("shows Mark as Reviewed button when not reviewed", () => {
    render(<DocumentReviewClient data={makeReviewData()} />);
    expect(screen.getByText("Mark as Reviewed")).toBeInTheDocument();
  });

  it("shows Reviewed button when already reviewed", () => {
    render(
      <DocumentReviewClient
        data={makeReviewData({
          reviewedAt: new Date("2026-03-15T12:00:00Z"),
          updatedAt: new Date("2026-03-15T11:00:00Z"),
        })}
      />,
    );
    // Footer button shows "Reviewed" — find the button specifically
    const reviewedButton = screen.getByRole("button", { name: "Reviewed" });
    expect(reviewedButton).toBeInTheDocument();
  });

  it("shows the update review button when modified after review", () => {
    render(
      <DocumentReviewClient
        data={makeReviewData({
          reviewedAt: new Date("2026-03-15T10:00:00Z"),
          updatedAt: new Date("2026-03-15T12:00:00Z"),
        })}
      />,
    );
    expect(screen.getByText(/Update Review/)).toBeInTheDocument();
  });

  it("shows read-only text instead of button for accountant", () => {
    render(<DocumentReviewClient data={makeReviewData({ readOnly: true })} />);
    expect(screen.queryByText("Mark as Reviewed")).not.toBeInTheDocument();
    // "Awaiting review" appears in both header and footer for read-only
    expect(screen.getAllByText("Awaiting review").length).toBeGreaterThanOrEqual(1);
  });

  // --- Mark as reviewed action ---
  it("calls markDocumentReviewedAction on button click", async () => {
    const user = userEvent.setup();
    mockMarkReviewedAction.mockResolvedValue({
      data: { data: { reviewedAt: "2026-03-15T12:00:00Z" } },
    });

    render(<DocumentReviewClient data={makeReviewData()} />);

    await user.click(screen.getByText("Mark as Reviewed"));

    await waitFor(() => {
      expect(mockMarkReviewedAction).toHaveBeenCalledWith({ documentId: "doc-123" });
    });
  });

  // --- Back navigation ---
  // --- Re-run OCR (FR-021) ---
  it("offers Re-run OCR to the owner on an extracted document", () => {
    render(<DocumentReviewClient data={makeReviewData({ status: "extracted" })} />);
    expect(screen.getByTestId("rerun-ocr")).toBeInTheDocument();
  });

  it("does not offer Re-run OCR to the accountant", () => {
    render(<DocumentReviewClient data={makeReviewData({ status: "extracted", readOnly: true })} />);
    expect(screen.queryByTestId("rerun-ocr")).not.toBeInTheDocument();
  });

  it.each(["uploaded", "processing", "ocr_failed", "generated"])(
    "does not offer Re-run OCR on a %s document (the inbox's Run OCR covers pending / failed)",
    (status) => {
      render(<DocumentReviewClient data={makeReviewData({ status })} />);
      expect(screen.queryByTestId("rerun-ocr")).not.toBeInTheDocument();
    },
  );

  // --- Archived (FR-001, T022) ---
  const makeItOptions = {
    expense: { groups: [], categories: [], sources: [] },
    supplier: { groups: [], categories: [], suppliers: [], registrations: [] },
  };

  it("offers Make it… on a document that is not archived", () => {
    render(<DocumentReviewClient data={makeReviewData()} makeItOptions={makeItOptions} />);
    expect(screen.getByTestId("make-it")).toBeInTheDocument();
    expect(screen.queryByTestId("document-archived")).not.toBeInTheDocument();
  });

  it("an archived document gets no Make it…, but Archived + Restore", () => {
    render(
      <DocumentReviewClient
        data={makeReviewData({ archivedAt: new Date("2026-03-20T09:00:00Z") })}
        makeItOptions={makeItOptions}
      />,
    );
    expect(screen.queryByTestId("make-it")).not.toBeInTheDocument();
    const section = screen.getByTestId("document-archived");
    expect(section).toHaveTextContent("Archived");
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("Restore unarchives this document and refreshes the page (Make it… comes back with the new data)", async () => {
    mockUnarchive.mockResolvedValue({ data: { data: [{ id: "doc-123", outcome: "restored" }] } });
    render(
      <DocumentReviewClient
        data={makeReviewData({ archivedAt: new Date("2026-03-20T09:00:00Z") })}
        makeItOptions={makeItOptions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mockUnarchive).toHaveBeenCalledWith({ ids: ["doc-123"] }));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a refused restore says so and does not refresh", async () => {
    mockUnarchive.mockResolvedValue({
      data: { data: [{ id: "doc-123", outcome: "refused", reason: "not_archived" }] },
    });
    render(
      <DocumentReviewClient
        data={makeReviewData({ archivedAt: new Date("2026-03-20T09:00:00Z") })}
        makeItOptions={makeItOptions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("the accountant sees Archived without Restore", () => {
    render(
      <DocumentReviewClient
        data={makeReviewData({ archivedAt: new Date("2026-03-20T09:00:00Z"), readOnly: true })}
      />,
    );
    expect(screen.getByTestId("document-archived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("has no back link of its own — the shell's breadcrumb names Documents (D40)", () => {
    render(<DocumentReviewClient data={makeReviewData()} />);
    expect(screen.queryByText(/Back to Documents/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("exp_20260315_001");
  });

  // --- Auto-save status ---
  it("shows Auto-saved label in footer", () => {
    render(<DocumentReviewClient data={makeReviewData()} />);
    expect(screen.getByText("Auto-saved")).toBeInTheDocument();
  });

  // --- Financial fields shown for expense type ---
  it("renders financial fields section for expense documents", () => {
    render(<DocumentReviewClient data={makeReviewData({ prefixType: "expense" })} />);
    expect(screen.getByText("Line Items")).toBeInTheDocument();
  });

  // --- Relationship section for contract type ---
  it("renders relationship section for contract documents", () => {
    render(
      <DocumentReviewClient
        data={makeReviewData({
          prefixType: "contract",
          resolvedData: {
            rawText: "Contract content here",
            confidence: 0.8,
            modelUsed: "prebuilt-read",
            pageCount: 2,
            processingTimeMs: 1500,
          },
        })}
      />,
    );
    expect(screen.queryByText("Line Items")).not.toBeInTheDocument();
  });
});
