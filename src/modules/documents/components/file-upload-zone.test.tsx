import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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
  became: { type: "expense"; id: string; label: string } | null = null,
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

  it("shows error state for oversized file", async () => {
    render(<FileUploadZone {...defaultProps} />);
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
    render(<FileUploadZone {...defaultProps} />);
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

    render(<FileUploadZone {...defaultProps} />);
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

    render(<FileUploadZone {...defaultProps} />);
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
      duplicateResult({ type: "expense", id: "exp-1", label: "Ex213-Tr-04" }),
    );
    mockExecuteAsync.mockResolvedValueOnce(successResult({ businessKey: "exp_20260314_002" }));

    render(<FileUploadZone {...defaultProps} />);
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
    render(<FileUploadZone {...defaultProps} />);
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

    render(<FileUploadZone {...defaultProps} />);
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

    render(<FileUploadZone {...defaultProps} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["pdf content"], "receipt.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(screen.getByText("Upload another")).toBeInTheDocument();

    await user.click(screen.getByText("Upload another"));

    expect(screen.getByText(/drop file here|tap to upload/i)).toBeInTheDocument();
  });

  it("calls onUploadComplete callback on success", async () => {
    const onComplete = vi.fn();
    mockExecuteAsync.mockResolvedValue(successResult());

    render(<FileUploadZone {...defaultProps} onUploadComplete={onComplete} />);
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

    render(<FileUploadZone {...defaultProps} onError={onError} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;

    const validFile = new File(["content"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [validFile] } });
    });

    expect(onError).toHaveBeenCalledWith({ code: "FORBIDDEN", message: "Requires owner role" });
  });

  it("shows toast when multiple files are dropped", async () => {
    mockExecuteAsync.mockResolvedValue(successResult());

    render(<FileUploadZone {...defaultProps} />);
    const zone = screen.getByLabelText("Upload document");

    const files = [
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
    ];

    const dataTransfer = {
      files,
      items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
      types: ["Files"],
    };

    await act(async () => {
      fireEvent.drop(zone, { dataTransfer });
    });

    expect(mockToast.info).toHaveBeenCalledWith("One file at a time");
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
