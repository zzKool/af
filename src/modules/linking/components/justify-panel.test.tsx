// The Justify panel (F124 (2), T008; F129 US3; F131): a proof already in the inbox is offered on the row and *Use it*
// opens the reading dialog on it, the paper question *(•) Invoice ( ) Receipt* before DI (D75) with the upload type
// following it, *Receipt lost* opening the dialog without a paper, the no-proof reasons' partner line.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/linking/linking.actions", () => ({
  counterpartyMemoryAction: "memory",
  justifyRowAction: "justify",
  noProofNeededAction: "noProof",
  suggestionsForTransactionAction: "forRow",
}));
vi.mock("@/modules/banking/ui", () => ({ createRuleFromTransactionAction: "rule" }));
vi.mock("@/modules/documents/ui", () => ({
  getDocumentForReviewAction: "readDocument",
  uploadDocumentAction: "upload",
  classifyDocumentAction: "classify",
}));
vi.mock("@/modules/partners/ui", () => ({
  isSystemRole: (v: unknown) =>
    typeof v === "string" && ["bank", "tax_agency_se", "tax_agency_ch", "owner"].includes(v),
}));
// the dialog itself has its own tests (`reading-dialog.test.tsx`): here only what the panel hands it
const dialogProps = vi.hoisted(() => ({ last: {} as Record<string, unknown> }));
vi.mock("./reading-dialog", () => ({
  ReadingDialog: (props: Record<string, unknown>) => {
    dialogProps.last = props;
    return <div data-testid="reading-dialog" data-document={String(props.documentId)} />;
  },
}));

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () => ({ data: { data: [] } }));
    return { executeAsync: calls[action], isPending: false };
  },
}));

import type { ProposalDto, Suggestion } from "../types";
import { type JustifyOptions, JustifyPanel } from "./justify-panel";

const ROW = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const row = {
  id: ROW,
  bookingDate: "2026-07-10",
  amount: "-123.88",
  currency: "SEK",
  amountBase: "-123.88",
  description: "Kortköp 260709 NORTHWIND#G100200300",
  counterpartyKey: "NORTHWIND#G100200300",
  bankAccountId: "acc",
  accountLabel: "Plusgirokonto SEK",
};
const options: JustifyOptions = {
  groups: [{ id: "g1", label: "2 — Licences" }],
  categories: [
    { code: "654", label: "654 · IT-tjänster (It)" },
    { code: "501", label: "501 · Lokalhyra (Lokal)" },
  ],
  partners: [
    {
      id: "p1",
      name: "Northwind Cloud AB",
      defaultBasCode: "654",
      types: ["vendor"],
      systemRole: null,
    },
    { id: "bank", name: "Nordea", defaultBasCode: null, types: ["vendor"], systemRole: "bank" },
    {
      id: "skv",
      name: "Skatteverket",
      defaultBasCode: null,
      types: ["authority"],
      systemRole: "tax_agency_se",
    },
  ],
};
const documentSuggestion: Suggestion = {
  candidate: {
    type: "document",
    id: DOC,
    label: "exp_20260709_001 · Northwind Cloud AB · 123.88 SEK",
    amount: "123.88",
    currency: "SEK",
    amountBase: null,
    date: "2026-07-09",
    reference: "G100200300",
    partnerName: "Northwind Cloud AB",
    texts: [],
    direction: "outgoing",
    remaining: "123.88",
  },
  score: 95,
  confidence: "HIGH",
  reasons: ["Exact amount match", "Within 2 days"],
  reference: true,
  crossCurrency: false,
  allocation: "123.88",
};
const basProposal = (basCode: string, prefilled: boolean): ProposalDto =>
  ({
    id: "pr1",
    runId: "run",
    targetId: ROW,
    source: "rule",
    confidence: prefilled ? 0.95 : 0.6,
    family: prefilled ? "high" : "medium",
    prefilled,
    reason: "Rule “Northwind”",
    model: null,
    createdAt: "2026-07-10T00:00:00Z",
    kind: "bas",
    payload: { basCode, alternatives: [] },
  }) as ProposalDto;

function rowSuggestions(suggestions: Suggestion[]) {
  calls.forRow = vi.fn(async () => ({
    data: { data: { row: { ...documentSuggestion.candidate, id: ROW }, suggestions } },
  }));
}

describe("JustifyPanel — the proof already in the inbox (T008)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("offers the inbox documents that score for the row, *Use it* opens the reading dialog on that document", async () => {
    rowSuggestions([documentSuggestion]);
    const resolvedData = {
      vendorName: "Northwind Cloud AB",
      vendorTaxId: "SE556000000001",
      invoiceNumber: "G100200300",
      invoiceTotal: 123.88,
      currency: "SEK",
      invoiceDate: "2026-07-09",
    };
    calls.readDocument = vi.fn(async () => ({
      data: {
        data: {
          status: "extracted",
          prefixType: "expense",
          fileUrl: "/api/documents/x/file",
          mimeType: "application/pdf",
          extractedData: { ...resolvedData, fields: {}, modelUsed: "prebuilt-invoice" },
          resolvedData,
        },
      },
    }));
    render(<JustifyPanel row={row} canWrite options={options} />);
    const offer = await screen.findByTestId("justify-inbox-proofs");
    expect(offer).toHaveTextContent("exp_20260709_001");
    expect(screen.queryByTestId("reading-dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("justify-use-proof"));

    await screen.findByTestId("reading-dialog");
    expect(calls.readDocument).toHaveBeenCalledWith({ documentId: DOC });
    // the dialog gets the document, its reading, the viewer's file and the paper the stored type says
    expect(dialogProps.last).toMatchObject({
      documentId: DOC,
      reading: resolvedData,
      paper: "receipt",
      document: { fileUrl: "/api/documents/x/file", mimeType: "application/pdf" },
    });
  });

  it("the paper question: Invoice by default, the upload sends the type the paper picks (D75)", async () => {
    rowSuggestions([]);
    calls.upload = vi.fn(async () => ({ data: { data: { kind: "stored", id: DOC } } }));
    calls.readDocument = vi.fn(async () => ({ data: { data: { status: "processing" } } }));
    render(<JustifyPanel row={row} canWrite options={options} />);
    await screen.findByTestId("justify-drop");
    expect(screen.getByTestId("justify-paper-invoice")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("justify-paper-receipt")).toHaveAttribute("aria-checked", "false");
    // the retired questions: no *Create as*, no compare card
    expect(screen.queryByTestId("justify-kind-expense")).not.toBeInTheDocument();
    expect(screen.queryByTestId("justify-card")).not.toBeInTheDocument();
    const file = new File(["%PDF-1.4"], "proof.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("justify-file"), { target: { files: [file] } });
    await waitFor(() => expect(calls.upload).toHaveBeenCalled());
    expect((calls.upload.mock.calls[0][0] as FormData).get("prefixType")).toBe("invoice");
    // Receipt picked → the receipt model's type
    cleanup();
    calls.upload = vi.fn(async () => ({ data: { data: { kind: "stored", id: DOC } } }));
    render(<JustifyPanel row={row} canWrite options={options} />);
    fireEvent.click(await screen.findByTestId("justify-paper-receipt"));
    expect(screen.getByTestId("justify-paper-receipt")).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByTestId("justify-file"), { target: { files: [file] } });
    await waitFor(() => expect(calls.upload).toHaveBeenCalled());
    expect((calls.upload.mock.calls[0][0] as FormData).get("prefixType")).toBe("expense");
  });

  it("the dialog's paper switch re-classifies the document and reads it again, the dialog staying up", async () => {
    rowSuggestions([]);
    calls.classify = vi.fn(async () => ({ data: { data: { reread: true } } }));
    calls.readDocument = vi.fn(async () => ({
      data: {
        data: {
          status: "extracted",
          prefixType: "invoice",
          fileUrl: "/f",
          mimeType: "application/pdf",
          extractedData: null,
          resolvedData: {},
        },
      },
    }));
    render(<JustifyPanel row={row} canWrite options={options} />);
    await screen.findByTestId("justify-drop");
    // a document uploaded before: the reading phase straight away (the *Use it* path) → the dialog
    rowSuggestions([documentSuggestion]);
    cleanup();
    render(<JustifyPanel row={row} canWrite options={options} />);
    fireEvent.click(await screen.findByTestId("justify-use-proof"));
    await screen.findByTestId("reading-dialog");
    (dialogProps.last.onPaper as (p: string) => void)("receipt");
    await waitFor(() =>
      expect(calls.classify).toHaveBeenCalledWith({ documentId: DOC, documentType: "expense" }),
    );
    // while the other model reads, the dialog is still there, told so
    expect(screen.getByTestId("reading-dialog")).toBeInTheDocument();
    await waitFor(() => expect(dialogProps.last).toMatchObject({ paper: "receipt" }));
  });

  it("nothing in the inbox: the drop zone alone, no offer", async () => {
    rowSuggestions([
      { ...documentSuggestion, candidate: { ...documentSuggestion.candidate, type: "expense" } },
    ]);
    render(<JustifyPanel row={row} canWrite options={options} />);
    await waitFor(() => expect(calls.forRow).toHaveBeenCalled());
    expect(screen.queryByTestId("justify-inbox-proofs")).not.toBeInTheDocument();
    expect(screen.getByTestId("justify-drop")).toBeInTheDocument();
  });
});

describe("JustifyPanel — the receipt lost opens the dialog without a paper", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("x (or the button): the dialog with no document — the facts are typed there", async () => {
    rowSuggestions([]);
    render(<JustifyPanel row={row} canWrite options={options} lostKey={1} />);
    const dialog = await screen.findByTestId("reading-dialog");
    expect(dialog).toHaveAttribute("data-document", "null");
    expect(dialogProps.last).toMatchObject({ documentId: null, document: null, reading: {} });
    // the dialog's Cancel brings the drop zone back
    (dialogProps.last.onCancel as () => void)();
    await waitFor(() => expect(screen.queryByTestId("reading-dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("justify-drop")).toBeInTheDocument();
  });

  it("a HIGH proposal is handed to the dialog as the row's proposals (F98 pre-fills there)", async () => {
    rowSuggestions([]);
    render(
      <JustifyPanel
        row={row}
        canWrite
        options={options}
        proposals={[basProposal("654", true)]}
        lostKey={1}
      />,
    );
    await screen.findByTestId("reading-dialog");
    expect((dialogProps.last.proposals as unknown[]).length).toBe(1);
  });
});

describe("JustifyPanel — no proof needed names a partner (F129 US3)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("bank fee: the bank proposed by its role (marked as a proposal), Done live; Done writes the reason and the partner", async () => {
    rowSuggestions([]);
    calls.memory = vi.fn(async () => ({ data: { data: [] } }));
    calls.noProof = vi.fn(async () => ({
      data: { data: { basCode: "657", partnerId: "bank", proposeRule: false } },
    }));
    render(<JustifyPanel row={row} canWrite options={options} noProofKey={1} />);
    fireEvent.click(await screen.findByTestId("justify-reason-fee"));
    const line = await screen.findByTestId("justify-partner-line");
    expect(line).toHaveTextContent("Nordea — proposed (the bank)");
    expect(screen.getByTestId("justify-no-proof-done")).toBeEnabled();
    fireEvent.click(screen.getByTestId("justify-no-proof-done"));
    await waitFor(() =>
      expect(calls.noProof).toHaveBeenCalledWith({
        transactionId: ROW,
        reason: "fee",
        partnerId: "bank",
      }),
    );
  });

  it("tax on a SEK row proposes Skatteverket; *other* with nothing remembered starts empty — Done waits", async () => {
    rowSuggestions([]);
    calls.memory = vi.fn(async () => ({ data: { data: [] } }));
    render(<JustifyPanel row={row} canWrite options={options} noProofKey={1} />);
    fireEvent.click(await screen.findByTestId("justify-reason-tax"));
    expect(await screen.findByTestId("justify-partner-line")).toHaveTextContent(
      "Skatteverket — proposed (the tax agency)",
    );
    fireEvent.click(screen.getByTestId("justify-reason-other"));
    await waitFor(() =>
      expect(screen.getByTestId("justify-partner-hint")).toHaveTextContent("Pick the partner"),
    );
    expect(screen.getByTestId("justify-no-proof-done")).toBeDisabled();
    expect(calls.noProof).not.toHaveBeenCalled();
  });

  it("the memory proposes when the reason has no partner by type (*remembered*); an inactive bank partner says so and proposes nothing", async () => {
    rowSuggestions([]);
    calls.memory = vi.fn(async () => ({
      data: { data: [{ partnerId: "p1", name: "Northwind Cloud AB", count: 3 }] },
    }));
    render(<JustifyPanel row={row} canWrite options={options} noProofKey={1} />);
    fireEvent.click(await screen.findByTestId("justify-reason-other"));
    await waitFor(() =>
      expect(screen.getByTestId("justify-partner-hint")).toHaveTextContent(
        "Northwind Cloud AB — remembered (3 time(s))",
      ),
    );
    expect(screen.getByTestId("justify-no-proof-done")).toBeEnabled();
    cleanup();
    calls.memory = vi.fn(async () => ({ data: { data: [] } }));
    const withoutBank: JustifyOptions = {
      ...options,
      partners: options.partners.filter((p) => p.systemRole !== "bank"),
      inactiveRoles: ["bank"],
    };
    render(<JustifyPanel row={row} canWrite options={withoutBank} noProofKey={1} />);
    fireEvent.click(await screen.findByTestId("justify-reason-fee"));
    expect(await screen.findByTestId("justify-partner-hint")).toHaveTextContent(
      "The partner for the bank is inactive",
    );
    expect(screen.getByTestId("justify-no-proof-done")).toBeDisabled();
  });

  it("an incoming row offers the reasons too, *client paid* first; no drop zone, no receipt lost", async () => {
    render(
      <JustifyPanel row={{ ...row, amount: "250.00" }} canWrite options={options} noProofKey={1} />,
    );
    const reasons = await screen.findByTestId("justify-reasons");
    const buttons = reasons.querySelectorAll("button");
    expect(buttons[0]).toHaveTextContent("Client paid");
    expect(screen.queryByTestId("justify-drop")).not.toBeInTheDocument();
    expect(screen.queryByTestId("justify-lost")).not.toBeInTheDocument();
  });
});

describe("JustifyPanel — the fourth exit, *This row refunds me* (F131 §5.1)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("an outgoing row while the owner is owed something: a link to the settle page with the row preselected", async () => {
    rowSuggestions([]);
    render(<JustifyPanel row={row} canWrite options={{ ...options, openPrivateCount: 2 }} />);
    await screen.findByTestId("justify-drop");
    expect(screen.getByTestId("justify-refund")).toHaveAttribute(
      "href",
      `/expenses/settle?row=${ROW}`,
    );
    expect(screen.getByTestId("justify-refund")).toHaveTextContent("This row refunds me");
    cleanup();
    // the reasons open (the inbox's `n` keeps them open on the next rows): the exit stays — it is not a reason
    render(
      <JustifyPanel
        row={row}
        canWrite
        options={{ ...options, openPrivateCount: 2 }}
        noProofKey={1}
      />,
    );
    await screen.findByTestId("justify-reasons");
    expect(screen.getByTestId("justify-refund")).toBeInTheDocument();
    expect(screen.queryByTestId("justify-lost")).not.toBeInTheDocument();
  });

  it("nothing open on the ledger, or an incoming row: no such exit", async () => {
    rowSuggestions([]);
    const { unmount } = render(
      <JustifyPanel row={row} canWrite options={{ ...options, openPrivateCount: 0 }} />,
    );
    await screen.findByTestId("justify-drop");
    expect(screen.queryByTestId("justify-refund")).not.toBeInTheDocument();
    unmount();
    render(
      <JustifyPanel
        row={{ ...row, amount: "250.00" }}
        canWrite
        options={{ ...options, openPrivateCount: 2 }}
      />,
    );
    await screen.findByTestId("justify-panel");
    expect(screen.queryByTestId("justify-refund")).not.toBeInTheDocument();
  });
});
