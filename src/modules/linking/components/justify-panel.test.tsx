// The Justify panel's first-use fixes (F124 (2), the owner's report of 2026-10-29): a proof already in the inbox is
// offered on the row (T008), *Create as* is labelled, a HIGH proposal pre-fills the category, and a greyed button
// says what it still needs.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
}));
vi.mock("@/modules/partners/ui", () => ({
  PartnerMatchCard: () => <div data-testid="partner-match" />,
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
  partners: [{ id: "p1", name: "Northwind Cloud AB", defaultBasCode: "654" }],
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

  it("offers the inbox documents that score for the row, *Use it* opens the card on that document", async () => {
    rowSuggestions([documentSuggestion]);
    calls.readDocument = vi.fn(async () => ({
      data: {
        data: {
          status: "extracted",
          resolvedData: {
            vendorName: "Northwind Cloud AB",
            vendorTaxId: "SE556000000001",
            invoiceNumber: "G100200300",
            invoiceTotal: 123.88,
            currency: "SEK",
            invoiceDate: "2026-07-09",
          },
        },
      },
    }));
    render(<JustifyPanel row={row} canWrite options={options} />);
    const offer = await screen.findByTestId("justify-inbox-proofs");
    expect(offer).toHaveTextContent("exp_20260709_001");
    expect(screen.queryByTestId("justify-card")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("justify-use-proof"));

    await screen.findByTestId("justify-card");
    expect(calls.readDocument).toHaveBeenCalledWith({ documentId: DOC });
    // the card: the document's facts beside the row's, the verdict, the kind a card purchase proposes
    const compare = screen.getByTestId("justify-compare");
    expect(compare).toHaveTextContent("Northwind Cloud AB");
    expect(compare).toHaveTextContent("2026-07-09");
    expect(screen.getByTestId("justify-verdict")).toHaveTextContent("amounts equal");
    expect(screen.getByTestId("justify-kind-expense")).toHaveAttribute("aria-checked", "true");
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

describe("JustifyPanel — the card says what it needs", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("*Create as* is labelled with its hint; the greyed button names the missing category", async () => {
    rowSuggestions([]);
    render(<JustifyPanel row={row} canWrite options={options} lostKey={1} />);
    const card = await screen.findByTestId("justify-card");
    expect(card).toHaveTextContent("Create as");
    expect(card).toHaveTextContent("A card purchase, a subscription or a till receipt");
    expect(screen.getByTestId("justify-create")).toBeDisabled();
    expect(screen.getByTestId("justify-missing")).toHaveTextContent("Still needed: Category");
  });

  it("a HIGH proposal pre-fills the category: the button is live, nothing is missing", async () => {
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
    await screen.findByTestId("justify-card");
    expect(screen.getByTestId("justify-category")).toHaveTextContent("654");
    expect(screen.getByTestId("justify-create")).toBeEnabled();
    expect(screen.queryByTestId("justify-missing")).not.toBeInTheDocument();
  });

  it("a MEDIUM proposal pre-fills nothing (PREFILL_HIGH is HIGH only)", async () => {
    rowSuggestions([]);
    render(
      <JustifyPanel
        row={row}
        canWrite
        options={options}
        proposals={[basProposal("501", false)]}
        lostKey={1}
      />,
    );
    await screen.findByTestId("justify-card");
    expect(screen.getByTestId("justify-create")).toBeDisabled();
    expect(screen.getByTestId("justify-missing")).toHaveTextContent("Category");
  });
});
