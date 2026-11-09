import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// V12 — the page polls for the issued PDF ~2 min; when the polls run out it says so and offers to poll again,
// instead of going quiet on "PDF is being generated…".
const refresh = vi.fn();
// F110: the try-again click queues the render again (through the action) before polling again
const requeue = vi.fn(async () => ({ data: { data: { queued: true } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
// F169: download and mark as sent — the stored PDF's URL, then the existing mark-as-sent action
const markSent = vi.fn(async (_: unknown) => ({ data: { data: { id: "inv-1" } } }));
const downloadUrl = vi.fn(
  async (_: unknown) =>
    ({ data: { data: { downloadUrl: "https://blob.test/inv.pdf" } } }) as unknown,
);
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: unknown) => ({
    executeAsync:
      action === "requeue"
        ? requeue
        : action === "markSent"
          ? markSent
          : action === "download"
            ? downloadUrl
            : vi.fn(),
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/modules/documents/ui", () => ({ getDocumentDownloadUrlAction: "download" }));
vi.mock("@/modules/invoices/invoices.actions", () => ({
  convertQuoteAction: vi.fn(),
  copyToDraftAction: vi.fn(),
  createCreditNoteAction: vi.fn(),
  decideQuoteAction: vi.fn(),
  deleteDraftAction: vi.fn(),
  issueInvoiceAction: vi.fn(),
  markSentAction: "markSent",
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

describe("InvoiceActions — download and mark as sent (F169)", () => {
  const open = vi.fn();
  beforeEach(() => {
    vi.useRealTimers();
    open.mockReset();
    markSent.mockClear();
    downloadUrl.mockClear();
    vi.stubGlobal("open", open);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("issued, not sent: the primary — the stored PDF opens, then the invoice is marked sent", async () => {
    render(<InvoiceActions {...props} pdfDocumentId="doc-1" />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[buttons.length - 1]).toHaveTextContent("Download and mark as sent");
    await act(async () => {
      fireEvent.click(screen.getByTestId("download-and-send"));
    });
    expect(downloadUrl).toHaveBeenCalledWith({ documentId: "doc-1" });
    expect(open).toHaveBeenCalledWith("https://blob.test/inv.pdf", "_blank", "noopener");
    expect(markSent).toHaveBeenCalledWith({ id: "inv-1" });
  });

  it("before the job stored the PDF: the PDF made now, then marked sent", async () => {
    render(<InvoiceActions {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("download-and-send"));
    });
    expect(open).toHaveBeenCalledWith("/invoices/inv-1/pdf", "_blank", "noopener");
    expect(markSent).toHaveBeenCalledWith({ id: "inv-1" });
  });

  it("no PDF, no stamp: a refused download leaves the invoice unsent", async () => {
    downloadUrl.mockResolvedValueOnce({ serverError: { message: "Blob store down" } });
    render(<InvoiceActions {...props} pdfDocumentId="doc-1" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("download-and-send"));
    });
    expect(markSent).not.toHaveBeenCalled();
  });

  it("only while issued: a sent invoice or a reader has no such button", () => {
    render(<InvoiceActions {...props} status="sent" state="sent" />);
    expect(screen.queryByTestId("download-and-send")).toBeNull();
    cleanup();
    render(<InvoiceActions {...props} canWrite={false} />);
    expect(screen.queryByTestId("download-and-send")).toBeNull();
  });
});
