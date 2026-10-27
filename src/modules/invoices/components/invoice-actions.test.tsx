import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// V12 — the page polls for the issued PDF ~2 min; when the polls run out it says so and offers to poll again,
// instead of going quiet on "PDF is being generated…".
const refresh = vi.fn();
// F110: the try-again click queues the render again (through the action) before polling again
const requeue = vi.fn(async () => ({ data: { data: { queued: true } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: unknown) => ({
    executeAsync: action === "requeue" ? requeue : vi.fn(),
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/modules/documents/ui", () => ({ getDocumentDownloadUrlAction: vi.fn() }));
vi.mock("@/modules/invoices/invoices.actions", () => ({
  convertQuoteAction: vi.fn(),
  copyToDraftAction: vi.fn(),
  createCreditNoteAction: vi.fn(),
  decideQuoteAction: vi.fn(),
  deleteDraftAction: vi.fn(),
  issueInvoiceAction: vi.fn(),
  markSentAction: vi.fn(),
  requeueInvoicePdfAction: "requeue",
}));

import { InvoiceActions } from "./invoice-actions";

const props = {
  id: "inv-1",
  type: "invoice" as const,
  status: "issued" as const,
  state: "issued" as const,
  numberHint: null,
  pdfDocumentId: null,
  canWrite: true,
};

/** Advance one poll at a time — each poll re-renders and schedules the next timer. */
async function runPolls(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      vi.advanceTimersToNextTimer();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InvoiceActions — the PDF poll (V12)", () => {
  it("after the last poll: a try-again hint that starts the polls over", async () => {
    render(<InvoiceActions {...props} />);
    expect(screen.queryByTestId("pdf-poll-again")).toBeNull();

    await runPolls(29);
    expect(refresh).toHaveBeenCalledTimes(29);
    expect(screen.queryByTestId("pdf-poll-again")).toBeNull(); // still polling: no hint yet

    await runPolls(1);
    expect(refresh).toHaveBeenCalledTimes(30);
    expect(screen.getByTestId("pdf-poll-again")).toHaveTextContent("Generate again");
    await runPolls(3);
    expect(refresh).toHaveBeenCalledTimes(30); // quiet: no timer left

    fireEvent.click(screen.getByTestId("pdf-poll-again"));
    await act(async () => {}); // the requeue action resolves, then the polls start over
    expect(requeue).toHaveBeenCalledWith({ id: "inv-1" });
    expect(refresh).toHaveBeenCalledTimes(31);
    expect(screen.queryByTestId("pdf-poll-again")).toBeNull();
    await runPolls(1);
    expect(refresh).toHaveBeenCalledTimes(32); // polling again
  });

  it("no hint once the PDF is there", () => {
    render(<InvoiceActions {...props} pdfDocumentId="doc-1" />);
    expect(screen.getByTestId("download-pdf")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-pending")).toBeNull();
  });
});
