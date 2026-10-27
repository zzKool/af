import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import shortcuts from "../../../../specs/documents/fixtures/inbox-shortcuts.json";
import type { InboxData, InboxItem } from "../queries";

const m = vi.hoisted(() => ({
  archive: vi.fn(),
  unarchive: vi.fn(),
  runOcr: vi.fn(),
  list: vi.fn(),
  markReviewed: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="preview" /> }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: unknown) => ({
    executeAsync: action as (input: unknown) => Promise<unknown>,
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/modules/documents/documents.actions", () => ({
  archiveDocumentsAction: m.archive,
  unarchiveDocumentsAction: m.unarchive,
  runOcrAction: m.runOcr,
  listInboxAction: m.list,
  markDocumentReviewedAction: m.markReviewed,
}));
vi.mock("@/modules/expenses/ui", () => ({
  NewExpenseDialog: ({ open, initial }: { open: boolean; initial?: unknown }) =>
    open ? (
      <div role="dialog" data-testid="expense-dialog">
        {JSON.stringify(initial)}
      </div>
    ) : null,
}));
vi.mock("@/modules/supplier-invoices/ui", () => ({
  NewSupplierInvoiceDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" data-testid="si-dialog" /> : null,
}));
vi.mock("@/modules/linking/ui", () => ({
  SuggestionsSection: ({
    applyRequest,
    openSearchKey,
    limit,
  }: {
    applyRequest?: unknown;
    openSearchKey: number;
    limit?: number;
  }) => (
    <div data-testid="suggestions" data-limit={limit} data-search={openSearchKey}>
      {JSON.stringify(applyRequest ?? null)}
    </div>
  ),
}));

import { InboxWorkbench, isTyping } from "./inbox-workbench";

function row(id: string, over: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    businessKey: `exp_20260301_${id}`,
    fileName: `${id}.pdf`,
    prefixType: "expense",
    documentType: "financial",
    mimeType: "application/pdf",
    status: "extracted",
    state: "ready",
    duplicateOf: null,
    hasTwin: false,
    vendor: "SBB",
    amount: "85.00",
    currency: "CHF",
    documentDate: "2026-03-01",
    quality: "high",
    facts: { vendorName: "SBB", invoiceTotal: 85, currency: "CHF", invoiceDate: "2026-03-01" },
    reviewedAt: null,
    archivedAt: null,
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    ...over,
  };
}

const counts = { pending: 1, ready: 2, duplicates: 0, archived: 1, total: 3 };
const ROWS = [row("001"), row("002", { state: "needs_ocr", status: "uploaded" }), row("003")];
const data = (rows: InboxItem[] = ROWS): InboxData => ({ rows, counts });
const options = {
  expense: { groups: [], categories: [], sources: [] },
  supplier: { groups: [], categories: [], suppliers: [], registrations: [] },
};

const key = (k: string, target: Element | Window = window) => fireEvent.keyDown(target, { key: k });
const openKey = () => screen.getByTestId("inbox-pane-key").textContent;

function renderOwner(rows = ROWS) {
  return render(<InboxWorkbench initial={data(rows)} canWrite options={options} />);
}

beforeEach(() => {
  m.list.mockResolvedValue({ data: { data: data() } });
  m.runOcr.mockResolvedValue({ data: { data: { id: "002", previousStatus: "uploaded" } } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InboxWorkbench — the keyboard (specs/documents US4-3, inbox-shortcuts.json)", () => {
  it("j / k and the arrows move the pane, wrapping", () => {
    renderOwner();
    expect(openKey()).toBe("exp_20260301_001");
    key("j");
    expect(openKey()).toBe("exp_20260301_002");
    key("ArrowDown");
    key("j");
    expect(openKey()).toBe("exp_20260301_001"); // wrapped
    key("k");
    expect(openKey()).toBe("exp_20260301_003"); // wrapped back
    key("ArrowUp");
    expect(openKey()).toBe("exp_20260301_002");
  });

  it("x ticks the open row, a ticks all / none", () => {
    renderOwner();
    key("x");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    key("a");
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    key("a");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("d archives the selection, else the open row; u restores exactly what succeeded", async () => {
    m.archive.mockResolvedValue({
      data: {
        data: [
          { id: "001", outcome: "archived" },
          { id: "003", outcome: "refused", reason: "not_inbox" },
        ],
      },
    });
    m.unarchive.mockResolvedValue({ data: { data: [{ id: "001", outcome: "restored" }] } });
    renderOwner();
    key("x"); // 001
    key("j");
    key("j");
    key("x"); // 003
    await act(async () => key("d"));
    expect(m.archive).toHaveBeenCalledWith({ ids: ["001", "003"] });
    expect(m.toast.message).toHaveBeenCalledWith(
      "Archived 1 document(s), 1 refused — archive is only for inbox rows",
    );
    expect(screen.getByTestId("inbox-undo")).toHaveTextContent("Archived 1 document(s)");
    expect(m.list).toHaveBeenCalled(); // the list reloads

    await act(async () => key("u"));
    expect(m.unarchive).toHaveBeenCalledWith({ ids: ["001"] });
    expect(m.toast.success).toHaveBeenCalledWith("Undone");
    expect(screen.queryByTestId("inbox-undo")).not.toBeInTheDocument();

    // nothing selected: d takes the open row (003, where j left it); z is u
    expect(openKey()).toBe("exp_20260301_003");
    m.archive.mockResolvedValue({ data: { data: [{ id: "003", outcome: "archived" }] } });
    m.unarchive.mockResolvedValue({ data: { data: [{ id: "003", outcome: "restored" }] } });
    await act(async () => key("d"));
    expect(m.archive).toHaveBeenLastCalledWith({ ids: ["003"] });
    await act(async () => key("z"));
    expect(m.unarchive).toHaveBeenLastCalledWith({ ids: ["003"] });
    await act(async () => key("u"));
    expect(m.toast.message).toHaveBeenCalledWith("Nothing to undo");
  });

  it("o runs the OCR on a pending row only", async () => {
    renderOwner();
    await act(async () => key("o")); // 001 is ready
    expect(m.runOcr).not.toHaveBeenCalled();
    key("j");
    await act(async () => key("o"));
    expect(m.runOcr).toHaveBeenCalledWith({ documentId: "002" });
    expect(m.toast.success).toHaveBeenCalledWith("OCR started for exp_20260301_002");
  });

  it("e / i open Make it… pre-filled; the page's keys are quiet while a dialog is open", () => {
    renderOwner();
    key("e");
    const dialog = screen.getByTestId("expense-dialog");
    expect(dialog).toHaveTextContent('"amount":"85.00"');
    expect(dialog).toHaveTextContent('"documentId":"001"');
    key("j");
    key("d");
    expect(openKey()).toBe("exp_20260301_001");
    expect(m.archive).not.toHaveBeenCalled();
  });

  it("i opens the supplier invoice dialog; not on a pending row", () => {
    renderOwner();
    key("j"); // 002 needs OCR
    key("i");
    expect(screen.queryByTestId("si-dialog")).not.toBeInTheDocument();
    key("k");
    key("i");
    expect(screen.getByTestId("si-dialog")).toBeInTheDocument();
  });

  it("Enter asks for the top HIGH bank row, 1–3 for the n-th, l opens Link to…", () => {
    renderOwner();
    const sug = () => screen.getByTestId("suggestions");
    expect(sug()).toHaveAttribute("data-limit", "3");
    key("Enter");
    expect(JSON.parse(sug().textContent ?? "null")).toMatchObject({ index: 0, requireHigh: true });
    key("2");
    expect(JSON.parse(sug().textContent ?? "null")).toMatchObject({ index: 1, requireHigh: false });
    key("9");
    expect(JSON.parse(sug().textContent ?? "null")).toMatchObject({ index: 1 });
    key("l");
    expect(sug()).toHaveAttribute("data-search", "1");
  });

  it("is quiet while typing in the search", () => {
    renderOwner();
    const search = screen.getByTestId("inbox-search");
    key("j", search);
    key("d", search);
    expect(openKey()).toBe("exp_20260301_001");
    expect(m.archive).not.toHaveBeenCalled();
    expect(isTyping(search)).toBe(true);
    expect(isTyping(document.body)).toBe(false);
  });

  it("? toggles the help; Esc closes the pane, then clears the selection", () => {
    renderOwner();
    key("?");
    const help = screen.getByTestId("inbox-help");
    for (const s of shortcuts.shortcuts) {
      const first = s.keys[0] === "Esc" ? "Esc" : (s.keys[0] ?? "");
      expect(help.textContent).toContain(first === "1" ? "1 – 3" : first);
    }
    expect(help.textContent).toContain("u / z");
    key("?");
    key("x");
    key("Escape");
    expect(screen.queryByTestId("inbox-pane")).not.toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    key("Escape");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("r restores the selection on Archived, else refreshes", async () => {
    const parked = [row("009", { state: "archived" })];
    m.list.mockResolvedValue({ data: { data: data(parked) } });
    m.unarchive.mockResolvedValue({ data: { data: [{ id: "009", outcome: "restored" }] } });
    renderOwner();
    await act(async () => key("r"));
    expect(m.unarchive).not.toHaveBeenCalled();
    expect(m.list).toHaveBeenCalledWith({ tab: "all", q: undefined });
    await act(async () => fireEvent.click(screen.getByTestId("inbox-tab-archived")));
    expect(m.list).toHaveBeenLastCalledWith({ tab: "archived", q: undefined });
    await waitFor(() => expect(openKey()).toBe("exp_20260301_009"));
    key("x");
    await act(async () => key("r"));
    expect(m.unarchive).toHaveBeenCalledWith({ ids: ["009"] });
    // d does nothing on Archived
    await act(async () => key("d"));
    expect(m.archive).not.toHaveBeenCalled();
  });
});

describe("InboxWorkbench — the page", () => {
  it("shows the tabs with the counts, the state, the stuck caption and the twin", () => {
    renderOwner([
      row("001", { duplicateOf: { id: "000", businessKey: "exp_20260228_000" }, hasTwin: true }),
      row("002", { state: "stuck", status: "processing" }),
    ]);
    expect(screen.getByTestId("inbox-tab-all")).toHaveTextContent("All (3)");
    expect(screen.getByTestId("inbox-tab-pending")).toHaveTextContent("Pending (1)");
    expect(screen.getByTestId("inbox-tab-archived")).toHaveTextContent("Archived (1)");
    const [first, second] = screen.getAllByTestId("inbox-row");
    expect(first).toHaveTextContent("Duplicate of exp_20260228_000");
    expect(second).toHaveTextContent("Processing seems stuck");
    expect(within(second as HTMLElement).getByTestId("inbox-state")).toHaveTextContent(
      "Processing",
    );
  });

  it("the actions follow the state", () => {
    renderOwner();
    const actions = () => screen.getByTestId("inbox-actions");
    expect(within(actions()).queryByTestId("inbox-run-ocr")).not.toBeInTheDocument();
    expect(within(actions()).getByTestId("inbox-make-expense")).toBeInTheDocument();
    expect(within(actions()).getByTestId("inbox-archive")).toBeInTheDocument();
    key("j");
    expect(within(actions()).getByTestId("inbox-run-ocr")).toBeInTheDocument();
    expect(within(actions()).queryByTestId("inbox-make-expense")).not.toBeInTheDocument();
    expect(screen.queryByTestId("suggestions")).not.toBeInTheDocument(); // not ready → no bank rows
  });

  it("a relationship document is filed or archived, never made into an expense", () => {
    renderOwner([row("010", { documentType: "relationship", prefixType: "contract" })]);
    const actions = screen.getByTestId("inbox-actions");
    expect(within(actions).queryByTestId("inbox-make-expense")).not.toBeInTheDocument();
    expect(within(actions).getByTestId("inbox-file")).toBeInTheDocument();
    expect(screen.queryByTestId("suggestions")).not.toBeInTheDocument();
    key("e");
    expect(screen.queryByTestId("expense-dialog")).not.toBeInTheDocument();
  });

  it("an empty inbox says so", () => {
    renderOwner([]);
    expect(screen.getByTestId("inbox-empty")).toHaveTextContent("All caught up");
  });
});

describe("InboxWorkbench — the accountant (US4-7)", () => {
  it("reads the queue and the pane; no tick, no action, no writing key", async () => {
    render(<InboxWorkbench initial={data()} canWrite={false} options={null} />);
    expect(screen.queryAllByTestId("inbox-row-check")).toHaveLength(0);
    const actions = screen.getByTestId("inbox-actions");
    expect(within(actions).queryAllByRole("button")).toHaveLength(0);
    key("j");
    expect(openKey()).toBe("exp_20260301_002");
    for (const k of ["d", "o", "e", "i", "x", "a", "u", "Enter", "1"])
      await act(async () => key(k));
    expect(m.archive).not.toHaveBeenCalled();
    expect(m.runOcr).not.toHaveBeenCalled();
    expect(screen.queryByTestId("expense-dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    key("?");
    const keys = [...screen.getByTestId("inbox-help").querySelectorAll("kbd")].map(
      (k) => k.textContent,
    );
    expect(keys).toEqual(["j / ↓ · k / ↑", "?", "Esc"]);
  });
});
