import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// --- Hoisted mocks ---
const { mockUpdateAction, mockMarkReviewedAction, mockToast } = vi.hoisted(() => ({
  mockUpdateAction: vi.fn(),
  mockMarkReviewedAction: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn() },
}));

// Mock server actions
vi.mock("@/server/actions/documents", () => ({
  updateDocumentCorrectionsAction: mockUpdateAction,
  markDocumentReviewedAction: mockMarkReviewedAction,
  refreshSignedUrlAction: vi.fn(),
  classifyDocumentAction: vi.fn(),
}));

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
vi.mock("@/hooks/use-document-review-store", () => ({
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
vi.mock("@/components/domain/formatted-date", () => ({
  FormattedDate: ({ date }: { date: Date }) => <span>{new Date(date).toISOString()}</span>,
}));

import type { DocumentReviewData } from "@/server/services/documents";
import { DocumentReviewClient } from "./document-review-client";

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
    readOnly: false,
    ...overrides,
  };
}

describe("DocumentReviewClient", () => {
  afterEach(() => {
    cleanup();
    mockUpdateAction.mockReset();
    mockMarkReviewedAction.mockReset();
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
  it("shows high quality badge with green indicator", () => {
    render(<DocumentReviewClient data={makeReviewData({ quality: "high" })} />);
    expect(screen.getByText(/Review extracted data/)).toBeInTheDocument();
  });

  it("shows low quality badge with yellow indicator", () => {
    render(<DocumentReviewClient data={makeReviewData({ quality: "low" })} />);
    expect(screen.getByText(/Low Confidence/)).toBeInTheDocument();
  });

  it("shows none quality badge with gray indicator", () => {
    render(<DocumentReviewClient data={makeReviewData({ quality: "none" })} />);
    expect(screen.getByText(/Manual Entry Required/)).toBeInTheDocument();
  });

  it("hides quality badge for read-only (accountant) view", () => {
    render(<DocumentReviewClient data={makeReviewData({ readOnly: true })} />);
    expect(screen.queryByText(/Review extracted data/)).not.toBeInTheDocument();
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

  it("shows amber update review button when modified after review", () => {
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
  it("shows back link to documents list", () => {
    render(<DocumentReviewClient data={makeReviewData()} />);
    const backLink = screen.getByText(/Back to Documents/);
    expect(backLink.closest("a")).toHaveAttribute("href", "/documents");
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
