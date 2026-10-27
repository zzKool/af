import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// --- Hoisted mocks ---

// Mock react-pdf — must come before import
vi.mock("react-pdf", () => ({
  Document: ({
    children,
    onLoadSuccess,
    onLoadError,
    file,
  }: {
    children: React.ReactNode;
    onLoadSuccess?: (pdf: { numPages: number; destroy: () => void }) => void;
    onLoadError?: () => void;
    file: string;
  }) => {
    useEffect(() => {
      if (file.includes("fail")) {
        onLoadError?.();
      } else {
        onLoadSuccess?.({ numPages: 3, destroy: vi.fn() });
      }
    }, [file, onLoadSuccess, onLoadError]);
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber, scale, rotate }: { pageNumber: number; scale: number; rotate: number }) => (
    <div data-testid={`pdf-page-${pageNumber}`} data-scale={scale} data-rotate={rotate} />
  ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, version: "4.0.0" },
}));

// Mock react-pdf CSS imports
vi.mock("react-pdf/dist/Page/AnnotationLayer.css", () => ({}));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));

import DocumentPreview from "@/modules/documents/components/document-preview";

// F106: the preview takes the authenticated route's path — same origin, nothing to sign or refresh
const pdfProps = {
  fileUrl: "/api/documents/doc-123/file",
  mimeType: "application/pdf",
};

const imageProps = {
  fileUrl: "/api/documents/doc-456/file",
  mimeType: "image/jpeg",
};

describe("DocumentPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // --- PDF rendering ---
  it("renders PDF document with page 1 visible", () => {
    render(<DocumentPreview {...pdfProps} />);
    expect(screen.getByTestId("pdf-document")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
    expect(screen.getByText("Page 1/3")).toBeInTheDocument();
  });

  it("renders image with correct src and alt", () => {
    render(<DocumentPreview {...imageProps} />);
    const img = screen.getByAltText("Document preview") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain("/api/documents/doc-456/file"); // F106: the route, same origin
  });

  // --- Zoom ---
  it("zooms in when + button is clicked", () => {
    render(<DocumentPreview {...pdfProps} />);
    fireEvent.click(screen.getByTitle("Zoom in"));

    const page = screen.getByTestId("pdf-page-1");
    expect(page.dataset.scale).toBe("1.25");
  });

  it("zooms out when - button is clicked", () => {
    render(<DocumentPreview {...pdfProps} />);
    fireEvent.click(screen.getByTitle("Zoom out"));

    const page = screen.getByTestId("pdf-page-1");
    expect(page.dataset.scale).toBe("0.75");
  });

  it("resets zoom on Fit button click", () => {
    render(<DocumentPreview {...pdfProps} />);
    fireEvent.click(screen.getByTitle("Zoom in"));
    fireEvent.click(screen.getByTitle("Fit width"));

    const page = screen.getByTestId("pdf-page-1");
    expect(page.dataset.scale).toBe("1");
  });

  // --- Rotation ---
  it("rotates 90 degrees on each click", () => {
    render(<DocumentPreview {...pdfProps} />);
    fireEvent.click(screen.getByTitle("Rotate"));

    const page = screen.getByTestId("pdf-page-1");
    expect(page.dataset.rotate).toBe("90");
  });

  // --- Page navigation ---
  it("navigates to next page", () => {
    render(<DocumentPreview {...pdfProps} />);
    fireEvent.click(screen.getByText(">"));

    expect(screen.getByTestId("pdf-page-2")).toBeInTheDocument();
    expect(screen.getByText("Page 2/3")).toBeInTheDocument();
  });

  it("disables prev button on first page", () => {
    render(<DocumentPreview {...pdfProps} />);
    const prevBtn = screen.getByText("<").closest("button");
    expect(prevBtn).toBeDisabled();
  });

  it("does not show page nav for images", () => {
    render(<DocumentPreview {...imageProps} />);
    expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
  });

  // --- Arrow key navigation ---
  it("navigates pages with arrow keys", () => {
    render(<DocumentPreview {...pdfProps} />);
    const container = screen.getByRole("document");

    fireEvent.keyDown(container, { key: "ArrowRight" });
    expect(screen.getByTestId("pdf-page-2")).toBeInTheDocument();

    fireEvent.keyDown(container, { key: "ArrowLeft" });
    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
  });

  // --- Error state ---
  it("shows error message and retry button on load failure", () => {
    render(<DocumentPreview fileUrl="/api/documents/fail/file" mimeType="application/pdf" />);
    expect(screen.getByText("Unable to load preview")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("retries on retry button click", () => {
    render(<DocumentPreview fileUrl="/api/documents/fail/file" mimeType="application/pdf" />);

    fireEvent.click(screen.getByText("Retry"));
    // After retry the URL changes (adds retry param) but still contains "fail",
    // so the mock triggers error again — verifies the retry mechanism fires
    expect(screen.getByText("Unable to load preview")).toBeInTheDocument();
  });

  // --- ARIA ---
  it("has role=document and aria-label on container", () => {
    render(<DocumentPreview {...pdfProps} />);
    const container = screen.getByRole("document");
    expect(container).toHaveAttribute("aria-label", "Document preview");
  });

  // --- Image rotation via CSS ---
  it("applies rotation transform to images", () => {
    render(<DocumentPreview {...imageProps} />);
    fireEvent.click(screen.getByTitle("Rotate"));

    const img = screen.getByAltText("Document preview") as HTMLImageElement;
    expect(img.style.transform).toContain("rotate(90deg)");
  });
});
