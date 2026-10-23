// F61-b: a receipt whose currency OCR did not read reaches linking with `currency: null`. The documents inbox's
// suggestions panel (this component on a document endpoint) renders it — no amount, no throw — and *Link* sends no
// allocation. The renderers print nothing for a currency they cannot format (`formatCurrency` throws on one).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
import { moneyText } from "./money";
import { SuggestionsSection } from "./suggestions-section";

const DOC = "22222222-2222-4222-8222-222222222222";
const ROW = "11111111-1111-4111-8111-111111111111";

const receipt: EntityFacts = {
  type: "document",
  id: DOC,
  label: "DOC-0042 · Migros · 45.90",
  amount: "45.90",
  currency: null,
  amountBase: null,
  date: "2026-03-10",
  reference: null,
  partnerName: "Migros",
  texts: [],
  direction: "outgoing",
  remaining: "45.90",
};
const row: EntityFacts = {
  ...receipt,
  type: "bank_transaction",
  id: ROW,
  label: "MIGROS NEUCHATEL",
  amount: "45.90",
  currency: "CHF",
  remaining: "45.90",
};

describe("a receipt whose currency was not read (F61-b)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("the documents inbox panel renders it, without an amount, and links it without an allocation", async () => {
    calls.forEntity = vi.fn(async () => ({
      data: {
        data: {
          entity: receipt,
          suggestions: [
            {
              candidate: row,
              score: 55,
              confidence: "MEDIUM",
              reasons: ["Partner name match", "Same date"],
              reference: true,
              crossCurrency: false,
              allocation: null,
            } satisfies Suggestion,
          ],
        },
      },
    }));
    calls.apply = vi.fn(async () => ({ data: { data: { id: "l1" } } }));
    render(
      <SuggestionsSection
        target={{ endpoint: { type: "document", id: DOC } }}
        canWrite
        limit={3}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId("suggestion")).toHaveLength(1));
    // no "remaining …" in a currency nobody knows, no allocation field, no "other currency" hint
    expect(screen.queryByText(/45[.,]90 SEK/)).toBeNull();
    expect(screen.queryByTestId("suggestion-allocation")).toBeNull();
    expect(screen.queryByText(/Other currency/)).toBeNull();
    fireEvent.click(screen.getByTestId("suggestion-link"));
    await waitFor(() => expect(calls.apply).toHaveBeenCalledTimes(1));
    expect(calls.apply.mock.calls[0][0]).toMatchObject({
      bankTransactionId: ROW,
      to: { type: "document", id: DOC },
      allocatedAmount: undefined,
    });
  });

  it("moneyText prints nothing for a currency it cannot format", () => {
    expect(moneyText("45.90", null)).toBeNull();
    expect(moneyText("45.90", "GBP")).toBeNull();
    expect(moneyText(null, "CHF")).toBeNull();
    expect(moneyText("1200.00", "CHF")).toBe("1'200.00 CHF");
  });
});
