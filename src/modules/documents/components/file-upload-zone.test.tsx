import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

const { mockExecuteAsync, mockToast } = vi.hoisted(() => ({
  mockExecuteAsync: vi.fn(),
  mockToast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

// Mock next-safe-action hooks
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    executeAsync: mockExecuteAsync,
    isPending: false,
  }),
}));

// Mock server action
vi.mock("@/modules/documents/documents.actions", () => ({
  uploadDocumentAction: vi.fn(),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: mockToast,
}));

import { FileUploadZone } from "@/modules/documents/components/file-upload-zone";

const defaultProps = {
  prefixOptions: [
    { documentType: "expense", prefix: "exp_" },
    { documentType: "invoice", prefix: "inv_" },
  ],
};

/** the owner picks the type first — there is no default (D52) */
function renderWithType(ui: ReactElement, type = "expense") {
  const r = render(ui);
  fireEvent.change(screen.getByLabelText("Document type"), { target: { value: type } });
  return r;
}

function successResult(overrides?: Partial<{ id: string; businessKey: string; fileName: string }>) {
  return {
    data: {
      data: {
        kind: "stored",
        id: "doc-1",
        businessKey: "exp_20260314_001",
        fileName: "test.pdf",
        ...overrides,
      },
    },
  };
}

function duplicateResult(
  became: { type: "expense"; id: string; key: string } | null = null,
  uploadedByName: string | null = "Zikrija Saric",
) {
  return {
    data: {
      data: {
        kind: "duplicate",
        existing: {
          id: "doc-0",
          businessKey: "exp_20260301_004",
          fileName: "email.pdf",
          status: "extracted",
          createdAt: new Date("2026-03-01T10:00:00Z"),
          createdBy: "user-1",
          uploadedByName,
          became,
        },
      },
    },
  };
}

describe("FileUploadZone", () => {
  afterEach(() => {
    cleanup();
    mockExecuteAsync.mockReset();
    mockToast.info.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

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
    // the placeholder, then the kinds by their names — nothing chosen
    expect(select.options).toHaveLength(3);
    expect(select.value).toBe("");
    expect(select.options[1].textContent).toBe("Expense (exp_)");
  });

  it("asks for the type before an upload: nothing is posted, the type selector gets the focus", async () => {
    render(<FileUploadZone {...defaultProps} />);
    expect(screen.getByTestId("upload-choose-type")).toBeInTheDocument();
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(screen.getByLabelText("Upload document"));
    expect(clickSpy).not.toHaveBeenCalled(); // the file picker does not open

    const validFile = new File(["pdf content"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(mockExecuteAsync).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith(
      "Choose the document type first: it decides how the OCR reads it",
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Document type"));
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

  it("shows error state for oversized file", async () => {
    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const bigFile = new File(["x".repeat(11 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [bigFile] } });
    });

    expect(screen.getByText(/exceeds 10 MB limit/i)).toBeInTheDocument();
    expect(mockExecuteAsync).not.toHaveBeenCalled();
  });

  it("shows error state for unsupported file extension", async () => {
    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const exeFile = new File(["content"], "malware.exe", { type: "application/octet-stream" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [exeFile] } });
    });

    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    expect(mockExecuteAsync).not.toHaveBeenCalled();
  });

  it("calls executeAsync with FormData on valid file", async () => {
    mockExecuteAsync.mockResolvedValue(successResult());

    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["pdf content"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(mockExecuteAsync).toHaveBeenCalledTimes(1);
    const formData = mockExecuteAsync.mock.calls[0][0] as FormData;
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(formData.get("prefixType")).toBe("expense");
  });

  it("shows complete state with business key after successful upload", async () => {
    mockExecuteAsync.mockResolvedValue(successResult({ fileName: "receipt.pdf" }));

    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["pdf content"], "receipt.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();
    expect(screen.getByText("exp_20260314_001")).toBeInTheDocument();
    expect(screen.getByText("Upload another")).toBeInTheDocument();
  });

  it("shows the duplicate card instead of storing; Upload anyway re-posts with force", async () => {
    mockExecuteAsync.mockResolvedValueOnce(
      duplicateResult({ type: "expense", id: "exp-1", key: "Ex213-Tr-04" }),
    );
    mockExecuteAsync.mockResolvedValueOnce(successResult({ businessKey: "exp_20260314_002" }));

    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["pdf content"], "photo.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // the card: the existing key, what it became, the two ways out
    expect(screen.getByTestId("upload-duplicate")).toBeInTheDocument();
    expect(screen.getByTestId("upload-duplicate-key")).toHaveTextContent("exp_20260301_004");
    // FR-009, US2/AC1: the uploader's name and the key of what it became
    expect(screen.getByText(/Uploaded 2026-03-01 by Zikrija Saric/)).toBeInTheDocument();
    expect(screen.getByTestId("upload-duplicate-became")).toHaveTextContent(
      "became expense Ex213-Tr-04",
    );
    expect(screen.getByRole("link", { name: "Use existing document" })).toHaveAttribute(
      "href",
      "/documents/doc-0",
    );
    expect(screen.queryByText("Upload another")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload anyway" }));
    });
    expect(mockExecuteAsync).toHaveBeenCalledTimes(2);
    const formData = mockExecuteAsync.mock.calls[1][0] as FormData;
    expect(formData.get("force")).toBe("true");
    expect(screen.getByText("exp_20260314_002")).toBeInTheDocument();
  });

  it("a duplicate whose uploader is gone and that became nothing shows the date alone", async () => {
    mockExecuteAsync.mockResolvedValueOnce(duplicateResult(null, null));
    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["pdf"], "photo.pdf", { type: "application/pdf" })] },
      });
    });
    expect(screen.getByText("Uploaded 2026-03-01")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-duplicate-became")).not.toBeInTheDocument();
  });

  it("shows error state when server returns business error", async () => {
    mockExecuteAsync.mockResolvedValue({
      data: {
        error: { code: "VALIDATION_ERROR", message: "File content does not match expected format" },
      },
    });

    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["pdf content"], "fake.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(screen.getByText("File content does not match expected format")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("resets to idle state when 'Upload another' is clicked", async () => {
    const user = userEvent.setup();
    mockExecuteAsync.mockResolvedValue(successResult({ fileName: "receipt.pdf" }));

    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["pdf content"], "receipt.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(screen.getByText("Upload another")).toBeInTheDocument();

    await user.click(screen.getByText("Upload another"));

    expect(screen.getByText(/drop files here|tap to upload/i)).toBeInTheDocument();
  });

  it("calls onUploadComplete callback on success", async () => {
    const onComplete = vi.fn();
    mockExecuteAsync.mockResolvedValue(successResult());

    renderWithType(<FileUploadZone {...defaultProps} onUploadComplete={onComplete} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["pdf content"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "doc-1",
        businessKey: "exp_20260314_001",
        fileName: "test.pdf",
      }),
    );
  });

  it("calls onError callback on server error", async () => {
    const onError = vi.fn();
    mockExecuteAsync.mockResolvedValue({
      data: { error: { code: "FORBIDDEN", message: "Requires owner role" } },
    });

    renderWithType(<FileUploadZone {...defaultProps} onError={onError} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["content"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(onError).toHaveBeenCalledWith({ code: "FORBIDDEN", message: "Requires owner role" });
  });

  // --- F92: several files, one type ---
  function dropFiles(zone: HTMLElement, files: File[]) {
    const dataTransfer = {
      files,
      items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
      types: ["Files"],
    };
    return act(async () => {
      fireEvent.drop(zone, { dataTransfer });
    });
  }
  const pdfFile = (name: string) => new File([name], name, { type: "application/pdf" });

  it("a batch of 3: one uploaded, one duplicate, one failed — one row each, one refresh at the end", async () => {
    mockExecuteAsync
      .mockResolvedValueOnce(successResult({ businessKey: "exp_20260314_001", fileName: "a.pdf" }))
      .mockResolvedValueOnce(duplicateResult())
      .mockResolvedValueOnce({
        data: { error: { code: "VALIDATION_ERROR", message: "Not a PDF", retryable: false } },
      });
    const onBatchComplete = vi.fn();
    const onUploadComplete = vi.fn();

    renderWithType(
      <FileUploadZone
        {...defaultProps}
        onBatchComplete={onBatchComplete}
        onUploadComplete={onUploadComplete}
      />,
      "invoice",
    );
    await dropFiles(screen.getByLabelText("Upload document"), [
      pdfFile("a.pdf"),
      pdfFile("b.pdf"),
      pdfFile("c.pdf"),
    ]);

    // each file through the one-file action, with the one type chosen before
    expect(mockExecuteAsync).toHaveBeenCalledTimes(3);
    for (const [i, name] of ["a.pdf", "b.pdf", "c.pdf"].entries()) {
      const fd = mockExecuteAsync.mock.calls[i][0] as FormData;
      expect((fd.get("file") as File).name).toBe(name);
      expect(fd.get("prefixType")).toBe("invoice");
      expect(fd.get("force")).toBeNull();
    }

    const rows = screen.getAllByTestId("upload-batch-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual([
      "uploaded",
      "duplicate",
      "failed",
    ]);
    expect(within(rows[0]).getByTestId("upload-batch-key")).toHaveTextContent("exp_20260314_001");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/documents/doc-1");
    // the duplicate card's behaviour on its row
    expect(within(rows[1]).getByTestId("upload-batch-duplicate-key")).toHaveTextContent(
      "exp_20260301_004",
    );
    expect(within(rows[1]).getByRole("link", { name: "Use existing document" })).toHaveAttribute(
      "href",
      "/documents/doc-0",
    );
    expect(within(rows[2]).getByTestId("upload-batch-reason")).toHaveTextContent("Not a PDF");
    expect(screen.getByTestId("upload-batch-summary")).toHaveTextContent(
      "3 of 3 · 1 uploaded · 1 duplicates · 1 failed",
    );
    // the inbox count and the sidebar badge: one refresh for the batch, not one per file
    expect(onBatchComplete).toHaveBeenCalledTimes(1);
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it("a file refused before posting (too large) fails its row only; the others still upload", async () => {
    mockExecuteAsync.mockResolvedValue(successResult());
    renderWithType(<FileUploadZone {...defaultProps} />);
    const big = new File(["x".repeat(11 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    await dropFiles(screen.getByLabelText("Upload document"), [big, pdfFile("ok.pdf")]);

    expect(mockExecuteAsync).toHaveBeenCalledTimes(1);
    const rows = screen.getAllByTestId("upload-batch-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["failed", "uploaded"]);
    expect(within(rows[0]).getByText(/exceeds 10 MB limit/i)).toBeInTheDocument();
  });

  it("a row's second chance: Upload anyway posts that file with force, Try again posts it again", async () => {
    mockExecuteAsync
      .mockResolvedValueOnce(duplicateResult())
      .mockResolvedValueOnce({
        data: { error: { code: "INTERNAL_ERROR", message: "Storage down", retryable: true } },
      })
      .mockResolvedValueOnce(successResult({ businessKey: "exp_20260314_007" }))
      .mockResolvedValueOnce(successResult({ businessKey: "exp_20260314_008" }));
    const onBatchComplete = vi.fn();
    renderWithType(<FileUploadZone {...defaultProps} onBatchComplete={onBatchComplete} />);
    await dropFiles(screen.getByLabelText("Upload document"), [pdfFile("d.pdf"), pdfFile("e.pdf")]);
    expect(onBatchComplete).not.toHaveBeenCalled(); // nothing stored yet

    let rows = screen.getAllByTestId("upload-batch-row");
    await act(async () => {
      fireEvent.click(within(rows[0]).getByRole("button", { name: "Upload anyway" }));
    });
    const forced = mockExecuteAsync.mock.calls[2][0] as FormData;
    expect((forced.get("file") as File).name).toBe("d.pdf");
    expect(forced.get("force")).toBe("true");

    rows = screen.getAllByTestId("upload-batch-row");
    await act(async () => {
      fireEvent.click(within(rows[1]).getByRole("button", { name: "Try again" }));
    });
    const again = mockExecuteAsync.mock.calls[3][0] as FormData;
    expect((again.get("file") as File).name).toBe("e.pdf");
    expect(again.get("force")).toBeNull();

    rows = screen.getAllByTestId("upload-batch-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["uploaded", "uploaded"]);
    expect(onBatchComplete).toHaveBeenCalledTimes(2);
  });

  it("more than 50 files: nothing is posted, a toast says the limit", async () => {
    renderWithType(<FileUploadZone {...defaultProps} />);
    const files = Array.from({ length: 51 }, (_, i) => pdfFile(`f${i}.pdf`));
    await dropFiles(screen.getByLabelText("Upload document"), files);
    expect(mockExecuteAsync).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith("At most 50 files at once — choose fewer");
    expect(screen.queryByTestId("upload-batch")).not.toBeInTheDocument();
  });

  it("the file picker takes several files too; Upload more empties the list", async () => {
    mockExecuteAsync.mockResolvedValue(successResult());
    renderWithType(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    await act(async () => {
      fireEvent.change(input, { target: { files: [pdfFile("x.pdf"), pdfFile("y.pdf")] } });
    });
    expect(screen.getAllByTestId("upload-batch-row")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload more" }));
    });
    expect(screen.queryByTestId("upload-batch")).not.toBeInTheDocument();
  });

  it("several files without a type: nothing is posted, the type is asked for", async () => {
    render(<FileUploadZone {...defaultProps} />);
    await dropFiles(screen.getByLabelText("Upload document"), [pdfFile("a.pdf"), pdfFile("b.pdf")]);
    expect(mockExecuteAsync).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith(
      "Choose the document type first: it decides how the OCR reads it",
    );
  });

  it("changes prefix type via selector", async () => {
    const user = userEvent.setup();
    mockExecuteAsync.mockResolvedValue(
      successResult({ businessKey: "inv_20260314_001", fileName: "invoice.pdf" }),
    );

    render(<FileUploadZone {...defaultProps} />);
    const select = screen.getByLabelText("Document type");
    await user.selectOptions(select, "invoice");

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const validFile = new File(["pdf content"], "invoice.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(mockExecuteAsync).toHaveBeenCalledTimes(1);
    const formData = mockExecuteAsync.mock.calls[0][0] as FormData;
    expect(formData.get("prefixType")).toBe("invoice");
  });
});
