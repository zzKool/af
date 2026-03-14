import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock next-safe-action hooks
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    executeAsync: vi.fn(),
    isPending: false,
  }),
}));

// Mock server action
vi.mock("@/server/actions/documents", () => ({
  uploadDocumentAction: vi.fn(),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { FileUploadZone } from "./file-upload-zone";

const defaultProps = {
  prefixOptions: [
    { documentType: "expense", prefix: "exp_" },
    { documentType: "invoice", prefix: "inv_" },
  ],
};

describe("FileUploadZone", () => {
  it("renders drop zone with correct ARIA label", () => {
    render(<FileUploadZone {...defaultProps} />);
    const zone = screen.getByLabelText("Upload document");
    expect(zone).toBeInTheDocument();
    expect(zone).toHaveAttribute("role", "button");
  });

  it("shows prefix type selector with options", () => {
    render(<FileUploadZone {...defaultProps} />);
    const select = screen.getByLabelText("Document type") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options).toHaveLength(2);
    expect(select.options[0].textContent).toContain("expense");
  });

  it("shows file format and size info", () => {
    render(<FileUploadZone {...defaultProps} />);
    const elements = screen.getAllByText(/max 10 MB/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it("has hidden file input with correct accept attribute", () => {
    render(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toBe(".pdf,.jpg,.jpeg,.png,.tiff,.tif");
    expect(input.className).toContain("hidden");
  });
});
