import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { mockRunOcr, mockRefresh, mockToast } = vi.hoisted(() => ({
  mockRunOcr: vi.fn(),
  mockRefresh: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/modules/documents/documents.actions", () => ({ runOcrAction: mockRunOcr }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("sonner", () => ({ toast: mockToast }));

import { RerunOcrButton } from "./rerun-ocr-button";

describe("RerunOcrButton (FR-021: a completed OCR re-runs only explicitly, from the review page)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks first — nothing runs until the owner confirms, and the dialog says the corrections stay", async () => {
    render(<RerunOcrButton documentId="doc-1" documentKey="Ex1-Tr-01" />);
    await userEvent.click(screen.getByTestId("rerun-ocr"));
    expect(await screen.findByText(/corrections stay/i)).toBeInTheDocument();
    expect(mockRunOcr).not.toHaveBeenCalled();
  });

  it("confirming re-runs with force, then refreshes the page", async () => {
    mockRunOcr.mockResolvedValue({ data: { data: { id: "doc-1", previousStatus: "extracted" } } });
    render(<RerunOcrButton documentId="doc-1" documentKey="Ex1-Tr-01" />);
    await userEvent.click(screen.getByTestId("rerun-ocr"));
    await userEvent.click(await screen.findByRole("button", { name: "Re-run OCR" }));
    await waitFor(() =>
      expect(mockRunOcr).toHaveBeenCalledWith({ documentId: "doc-1", force: true }),
    );
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining("Ex1-Tr-01"));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a refusal is shown and the page is not refreshed", async () => {
    mockRunOcr.mockResolvedValue({
      data: {
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: "Cannot run the OCR on a processing document",
        },
      },
    });
    render(<RerunOcrButton documentId="doc-1" documentKey="Ex1-Tr-01" />);
    await userEvent.click(screen.getByTestId("rerun-ocr"));
    await userEvent.click(await screen.findByRole("button", { name: "Re-run OCR" }));
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("Cannot run the OCR on a processing document"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
