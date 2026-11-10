// The open document of the desk (F185): the field hovered on the right is the box lit on the page; an answer to a
// field to check is a correction on the document; *When you accept* — all three through justifyRow when a bank row
// pays it, both through the supplier invoice's create without one (a new month group made first), the form when
// the chain lacks something; the accountant sees no chain. Invented values (D51).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AcceptChain } from "@/modules/documents/accept-chain-rules";
import type { InboxItem } from "../queries";

const m = vi.hoisted(() => ({
  chain: vi.fn(),
  justify: vi.fn(),
  createSupplier: vi.fn(),
  correct: vi.fn(),
  resolveGroup: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
// the page: a stand-in that says which box is lit
vi.mock("next/dynamic", () => ({
  default: () => (p: { active: string | null }) => (
    <div data-testid="preview" data-active={p.active ?? ""} />
  ),
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: unknown) => ({
    executeAsync: action as (input: unknown) => Promise<unknown>,
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/modules/documents/documents.actions", () => ({
  updateDocumentCorrectionsAction: m.correct,
  classifyDocumentAction: vi.fn(),
}));
vi.mock("@/modules/expenses/ui", () => ({
  NEW_GROUP: "__new__",
  useCreateGroupIfNew: () => ({ resolveGroupId: m.resolveGroup, isPending: false }),
}));
vi.mock("@/modules/supplier-invoices/ui", () => ({
  createSupplierInvoiceAction: m.createSupplier,
}));
vi.mock("@/modules/subscriptions/ui", () => ({
  useSubscriptionMatches: () => [],
  FromSubscriptionButtons: () => null,
}));
vi.mock("@/modules/linking/ui", async () => ({
  documentAcceptChainAction: m.chain,
  justifyRowAction: m.justify,
  SuggestionsSection: () => <div data-testid="suggestions" />,
}));

import { InboxPane } from "./inbox-pane";

const ROW: InboxItem = {
  id: "doc-1",
  businessKey: "doc_20260706_001",
  fileName: "lindgren-30418.pdf",
  prefixType: "document",
  documentType: "financial",
  mimeType: "application/pdf",
  status: "extracted",
  state: "ready",
  duplicateOf: null,
  hasTwin: false,
  vendor: "Lindgren Kontorsservice AB",
  amount: "1297.20",
  currency: "SEK",
  documentDate: "2026-07-06",
  quality: "high",
  facts: {
    vendorName: "Lindgren Kontorsservice AB",
    invoiceNumber: "30418",
    invoiceDate: "2026-07-06",
    dueDate: "2026-08-07",
    invoiceTotal: 1297.2,
    currency: "SEK",
  },
  reading: {
    pages: [{ page: 1, width: 8.5, height: 11, unit: "inch" }],
    marks: [
      { key: "vendorName", confidence: 0.99, box: null },
      { key: "invoiceNumber", confidence: 0.97, box: null },
      { key: "dueDate", confidence: 0.72, box: null, content: "07-08" },
      { key: "invoiceTotal", confidence: 0.99, box: null },
    ],
    readMs: 2400,
  },
  corrected: [],
  reviewedAt: null,
  archivedAt: null,
  createdAt: "2026-07-06T10:00:00.000Z",
  updatedAt: "2026-07-06T10:00:00.000Z",
};

const CHAIN: AcceptChain = {
  documentId: "doc-1",
  kind: "supplier_invoice",
  key: "SI12-IT-03",
  vendor: "Lindgren Kontorsservice AB",
  group: { id: "g-1", number: 12, name: "July 2026", month: "2026-07", isNew: false },
  category: { code: "6540", label: "6540 · IT services (IT)", source: "partner" },
  partner: { id: "p-1", name: "Lindgren Kontorsservice AB", percent: 100 },
  bankRow: {
    id: "row-1",
    date: "2026-07-24",
    amount: "-1297.20",
    currency: "SEK",
    score: 98,
    label: "LINDGREN",
  },
  fields: {
    invoiceNumber: "30418",
    date: "2026-07-06",
    dueDate: "2026-08-07",
    currency: "SEK",
    amountTotal: "1297.20",
    vatAmount: null,
    amountNet: "1297.20",
  },
  missing: [],
};

function renderPane(over: { canWrite?: boolean; acceptRequest?: number } = {}) {
  const onMake = vi.fn();
  const onAccepted = vi.fn();
  const onLinked = vi.fn();
  const props = {
    row: ROW,
    canWrite: over.canWrite ?? true,
    canMake: over.canWrite ?? true,
    canFile: over.canWrite ?? true,
    canLink: true,
    busy: false,
    openSearchKey: 0,
    onOcr: vi.fn(),
    onMake,
    onFile: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onLinked,
    onAccepted,
  };
  const view = render(<InboxPane {...props} acceptRequest={over.acceptRequest ?? 0} />);
  return {
    onMake,
    onAccepted,
    onLinked,
    rerender: (n: number) => view.rerender(<InboxPane {...props} acceptRequest={n} />),
  };
}

beforeEach(() => {
  m.chain.mockResolvedValue({ data: { data: CHAIN } });
  m.resolveGroup.mockImplementation(async (id: string) => (id === "__new__" ? "g-new" : id));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InboxPane — the document and what it read", () => {
  it("the header says the kind, detected, its pages and the reading's time; the field to check is lit first, a hover moves it", async () => {
    renderPane();
    expect(screen.getByTestId("inbox-proposes")).toHaveTextContent(
      "Supplier invoicedetected · 1 page · read in 2.4 s",
    );
    expect(screen.getByTestId("preview")).toHaveAttribute("data-active", "dueDate");
    const total = screen
      .getAllByTestId("read-field")
      .find((r) => r.getAttribute("data-mark") === "invoiceTotal") as HTMLElement;
    fireEvent.mouseEnter(total);
    expect(screen.getByTestId("preview")).toHaveAttribute("data-active", "invoiceTotal");
    await waitFor(() => expect(screen.getByTestId("chain-accept")).toBeInTheDocument());
  });

  it("an answer to a field to check is a correction on the document, then the desk reloads", async () => {
    m.correct.mockResolvedValue({ data: { data: {} } });
    const { onLinked } = renderPane();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "2026-07-08" })));
    expect(m.correct).toHaveBeenCalledWith({
      documentId: "doc-1",
      patch: { dueDate: "2026-07-08" },
    });
    expect(onLinked).toHaveBeenCalled();
  });
});

describe("InboxPane — When you accept", () => {
  it("creates · links · files → Accept all three through justifyRow, one transaction", async () => {
    m.justify.mockResolvedValue({ data: { data: { entity: { key: "SI12-IT-03" } } } });
    const { onAccepted } = renderPane();
    const accept = await screen.findByTestId("chain-accept");
    expect(accept).toHaveTextContent("Accept all three");
    expect(screen.getByTestId("chain-creates")).toHaveTextContent("Supplier invoice SI12-IT-03");
    expect(screen.getByTestId("chain-links")).toHaveTextContent(
      "Bank row 2026-07-24 · −1 297.20 SEK",
    );
    expect(screen.getByTestId("chain-links")).toHaveTextContent("98 %");
    expect(screen.getByTestId("chain-files")).toHaveTextContent(
      "6540 IT services (IT) · partner Lindgren Kontorsservice AB",
    );
    await act(async () => fireEvent.click(accept));
    expect(m.justify).toHaveBeenCalledWith({
      transactionId: "row-1",
      documentId: "doc-1",
      kind: "supplier_invoice",
      supplier: expect.objectContaining({ groupId: "g-1", partnerId: "p-1", basCode: "6540" }),
    });
    expect(onAccepted).toHaveBeenCalledWith({
      id: "doc-1",
      key: "SI12-IT-03",
      kind: "supplier_invoice",
      bankRowDate: "2026-07-24",
    });
  });

  it("no bank row → Accept both: the month's new group first, then the supplier invoice's create; Enter does it too", async () => {
    m.chain.mockResolvedValue({
      data: {
        data: {
          ...CHAIN,
          bankRow: null,
          group: { id: null, number: 13, name: "2026-07", month: "2026-07", isNew: true },
        },
      },
    });
    m.createSupplier.mockResolvedValue({ data: { data: { key: "SI13-IT-01" } } });
    const { rerender } = renderPane();
    await waitFor(() =>
      expect(screen.getByTestId("chain-accept")).toHaveTextContent("Accept both"),
    );
    expect(screen.queryByTestId("chain-links")).not.toBeInTheDocument();
    expect(screen.getByTestId("chain-hint")).toHaveTextContent(
      "A new group 2026-07 is made with it.",
    );
    await act(async () => rerender(1));
    expect(m.resolveGroup).toHaveBeenCalledWith("__new__", "2026-07", "2026-07");
    expect(m.createSupplier).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "g-new", documentId: "doc-1", invoiceNumber: "30418" }),
    );
    expect(m.justify).not.toHaveBeenCalled();
  });

  it("a chain that lacks something says what, in amber, and its primary opens the form", async () => {
    m.chain.mockResolvedValue({
      data: { data: { ...CHAIN, partner: null, missing: ["partner"] } },
    });
    const { onMake } = renderPane();
    const accept = await screen.findByTestId("chain-accept");
    expect(accept).toHaveTextContent("Finish it in the form");
    expect(screen.getByTestId("chain-files")).toHaveAttribute("data-lacking", "true");
    expect(screen.getByTestId("chain-files")).toHaveTextContent("no partner matched");
    expect(screen.getByTestId("chain-hint")).toHaveTextContent("Still needs: no partner matched");
    fireEvent.click(accept);
    expect(onMake).toHaveBeenCalledWith("supplier");
    fireEvent.click(within(screen.getByTestId("chain-files")).getByRole("button"));
    expect(onMake).toHaveBeenCalledTimes(2);
  });

  it("the accountant: no chain read, no primary, no answer", () => {
    renderPane({ canWrite: false });
    expect(m.chain).not.toHaveBeenCalled();
    expect(screen.queryByTestId("accept-chain")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("read-field-answer")).toHaveLength(0);
  });
});
