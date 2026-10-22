// F58 (D37): an expense or a supplier invoice writes its own payment — the suggestions offer *Open* (its panel, the
// row preselected) instead of *Link*, and a payment link offers *Open* instead of *Unlink*. Other targets unchanged.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/linking/linking.actions", () => ({
  applySuggestionAction: "apply",
  removeLinkAction: "remove",
  searchLinkablesAction: "search",
  suggestionsForEntityAction: "forEntity",
  suggestionsForTransactionAction: "forRow",
}));

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn();
    return { executeAsync: calls[action], isPending: false };
  },
}));

import type { EntityFacts, Suggestion } from "../types";
import { LinksList } from "./links-list";
import { SuggestionsSection } from "./suggestions-section";

const ROW = "11111111-1111-4111-8111-111111111111";
const facts = (type: EntityFacts["type"], id: string, label: string): EntityFacts => ({
  type,
  id,
  label,
  amount: "120.00",
  currency: "SEK",
  amountBase: "120.00",
  date: "2026-03-10",
  reference: null,
  partnerName: null,
  texts: [],
  direction: "outgoing",
  remaining: "120.00",
});
const suggestion = (candidate: EntityFacts): Suggestion =>
  ({
    candidate,
    score: 90,
    confidence: "HIGH",
    reasons: ["Exact amount match"],
    crossCurrency: false,
    allocation: "120.00",
  }) as Suggestion;

describe("own payment flow (F58)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
    push.mockReset();
  });

  it("a suggested expense / supplier invoice opens its panel with the row; an invoice keeps *Link*", async () => {
    const expense = facts("expense", "e1", "Ex1-Tr-01");
    const si = facts("supplier_invoice", "s1", "SI1-Acc-01");
    const invoice = facts("invoice", "i1", "ACME26-001");
    calls.forRow = vi.fn(async () => ({
      data: {
        data: {
          row: facts("bank_transaction", ROW, "row"),
          suggestions: [suggestion(expense), suggestion(si), suggestion(invoice)],
        },
      },
    }));
    render(<SuggestionsSection target={{ bankTransactionId: ROW }} canWrite />);
    await waitFor(() => expect(screen.getAllByTestId("suggestion")).toHaveLength(3));
    const open = screen.getAllByTestId("suggestion-open-own");
    expect(open.map((a) => a.getAttribute("href"))).toEqual([
      `/expenses?open=e1&attach=${ROW}`,
      `/supplier-invoices?open=s1&attach=${ROW}`,
    ]);
    // only the client invoice is linked from here
    expect(screen.getAllByTestId("suggestion-link")).toHaveLength(1);
    expect(screen.getAllByTestId("suggestion-allocation")).toHaveLength(1);
  });

  it("a payment link of an expense offers *Open*, never *Unlink*; other links keep *Unlink*", () => {
    const base = {
      tenantId: "t",
      allocatedAmount: "120.00",
      currency: "SEK",
      note: null,
      createdAt: "2026-03-10T00:00:00Z",
      createdBy: "u",
      source: "web",
    };
    render(
      <LinksList
        self={{ type: "bank_transaction", id: ROW }}
        canWrite
        fallbackCurrency="SEK"
        links={[
          {
            ...base,
            id: "l1",
            kind: "justifies",
            from: { type: "bank_transaction", id: ROW },
            to: { type: "expense", id: "e1" },
            otherLabel: "Ex1-Tr-01",
          },
          {
            ...base,
            id: "l2",
            kind: "justifies",
            from: { type: "bank_transaction", id: ROW },
            to: { type: "invoice", id: "i1" },
            otherLabel: "ACME26-001",
          },
        ]}
      />,
    );
    expect(screen.getByTestId("open-own")).toHaveAttribute("href", "/expenses?open=e1");
    expect(screen.getAllByTestId("unlink")).toHaveLength(1);
  });
});
