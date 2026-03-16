"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server actions
vi.mock("@/server/actions/documents", () => ({
  getDocumentsAction: vi.fn(),
  getDocumentStatsAction: vi.fn(),
  getDocumentDownloadUrlAction: vi.fn(),
  getDocumentFilterOptionsAction: vi.fn(),
}));

vi.mock("@/server/actions/table-preferences", () => ({
  upsertTablePreferenceAction: vi.fn(),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock Zustand store — always return a fresh store per test
vi.mock("@/hooks/use-document-library-store", () => {
  // biome-ignore lint/suspicious/noExplicitAny: test mock requires dynamic require
  const { create } = require("zustand") as any;
  const store = create(() => ({
    filters: {},
    sort: { field: "createdAt", direction: "desc" },
    page: 1,
    pageSize: 25,
    setFilters: vi.fn(),
    setSort: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    clearFilters: vi.fn(),
  }));
  store.store = store;
  return { useDocumentLibraryStore: store };
});

import {
  getDocumentDownloadUrlAction,
  getDocumentStatsAction,
  getDocumentsAction,
} from "@/server/actions/documents";
import { DocumentLibraryClient } from "./document-library-client";

const mockGetDocumentsAction = vi.mocked(getDocumentsAction);
const mockGetDocumentStatsAction = vi.mocked(getDocumentStatsAction);
const mockGetDocumentDownloadUrlAction = vi.mocked(getDocumentDownloadUrlAction);

const EMPTY_DOCS = { data: { data: { items: [], totalCount: 0 } } };
const EMPTY_STATS = { data: { data: null } };

type DocItem = {
  id: string;
  businessKey: string;
  fileName: string;
  prefixType: string;
  documentType: string;
  status: string;
  createdAt: Date;
  fileSize: number;
  reviewedAt: Date | null;
  extractedVendor: string | null;
  extractedAmount: number | null;
  extractedCurrency: string | null;
  extractedDate: string | null;
};

function makeDocsResult(items: DocItem[], totalCount = items.length) {
  return { data: { data: { items, totalCount } } };
}

const sampleDoc: DocItem = {
  id: "doc-1",
  businessKey: "inv_20260315_001",
  fileName: "invoice.pdf",
  prefixType: "invoice",
  documentType: "financial",
  status: "extracted",
  createdAt: new Date("2026-03-15T10:00:00Z"),
  fileSize: 102400,
  reviewedAt: null,
  extractedVendor: "Lufthansa",
  extractedAmount: 12500,
  extractedCurrency: "SEK",
  extractedDate: "2026-03-15",
};

const filterOptions = {
  statuses: ["uploaded", "extracted", "ocr_failed"],
  documentTypes: ["financial"],
  prefixTypes: ["invoice", "expense"],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DocumentLibraryClient", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: next-safe-action mock return type
    mockGetDocumentsAction.mockResolvedValue(makeDocsResult([sampleDoc]) as any);
    // biome-ignore lint/suspicious/noExplicitAny: next-safe-action mock return type
    mockGetDocumentStatsAction.mockResolvedValue(EMPTY_STATS as any);
  });

  it("renders table with document data", async () => {
    render(
      // biome-ignore lint/a11y/useValidAriaRole: custom component prop, not HTML ARIA role
      <DocumentLibraryClient
        filterOptions={filterOptions}
        initialPreferences={null}
        role="owner"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("inv_20260315_001")).toBeDefined();
    });
  });

  it("accountant role renders without upload zone (upload zone is in parent page, not client)", async () => {
    render(
      // biome-ignore lint/a11y/useValidAriaRole: custom component prop, not HTML ARIA role
      <DocumentLibraryClient
        filterOptions={filterOptions}
        initialPreferences={null}
        role="accountant"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("inv_20260315_001")).toBeDefined();
    });
    // No upload-zone buttons inside this client component
    expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
  });

  it("renders empty state when no documents", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: next-safe-action mock return type
    mockGetDocumentsAction.mockResolvedValue(EMPTY_DOCS as any);

    render(
      // biome-ignore lint/a11y/useValidAriaRole: custom component prop, not HTML ARIA role
      <DocumentLibraryClient
        filterOptions={filterOptions}
        initialPreferences={null}
        role="owner"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText(/No documents uploaded yet/)).toBeDefined();
    });
  });

  it("renders accountant empty state for accountant role", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: next-safe-action mock return type
    mockGetDocumentsAction.mockResolvedValue(EMPTY_DOCS as any);

    render(
      // biome-ignore lint/a11y/useValidAriaRole: custom component prop, not HTML ARIA role
      <DocumentLibraryClient
        filterOptions={filterOptions}
        initialPreferences={null}
        role="accountant"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText(/No financial documents have been uploaded/)).toBeDefined();
    });
  });

  it("download button calls getDocumentDownloadUrlAction and creates <a> element (not window.open)", async () => {
    render(
      // biome-ignore lint/a11y/useValidAriaRole: custom component prop, not HTML ARIA role
      <DocumentLibraryClient
        filterOptions={filterOptions}
        initialPreferences={null}
        role="owner"
      />,
      { wrapper },
    );

    await waitFor(() => screen.getByText("inv_20260315_001"));

    mockGetDocumentDownloadUrlAction.mockResolvedValue({
      // biome-ignore lint/suspicious/noExplicitAny: next-safe-action mock return type
      data: { data: { downloadUrl: "https://blob.example.com/file?sig=abc" } },
    } as any);

    // Spy on document.createElement to verify <a download> pattern, not window.open
    const createElementSpy = vi.spyOn(document, "createElement");

    const downloadBtn = screen.getAllByTitle("Download")[0];
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(mockGetDocumentDownloadUrlAction).toHaveBeenCalledWith({ documentId: "doc-1" });
    });

    expect(createElementSpy).toHaveBeenCalledWith("a");
    createElementSpy.mockRestore();
  });

  it("stats bar renders when stats are available", async () => {
    mockGetDocumentStatsAction.mockResolvedValue({
      data: {
        data: {
          totalCount: 5,
          byStatus: { extracted: 3, ocr_failed: 1 },
          byType: { financial: 4 },
          unreviewed: 2,
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: next-safe-action mock return type
    } as any);

    render(
      // biome-ignore lint/a11y/useValidAriaRole: custom component prop, not HTML ARIA role
      <DocumentLibraryClient
        filterOptions={filterOptions}
        initialPreferences={null}
        role="owner"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText(/5 documents/i)).toBeDefined();
    });
  });
});
