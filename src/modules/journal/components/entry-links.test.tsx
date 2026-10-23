// T003: the journal panel's Proof section — a manual entry lists its links and offers *Link to…* (documents and
// invoices only, D37), a bank entry points to its bank row, the accountant sees no write control.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/journal/journal.actions", () => ({ linkEntryAction: "linkEntry" }));
vi.mock("@/modules/linking/linking.actions", () => ({
  getLinksWithLabelsAction: "links",
  removeLinkAction: "remove",
  searchLinkablesAction: "search",
}));

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () => ({ data: { data: [] } }));
    return { executeAsync: calls[action], isPending: false };
  },
}));

import { EntryLinks } from "./entry-links";

const ENTRY = "22222222-2222-4222-8222-222222222222";
const TX = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const manual = { id: ENTRY, sourceType: "manual" as const, sourceId: null, currency: "SEK" };

describe("EntryLinks (T003)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("a manual entry lists its links and links a searched document through the journal's action", async () => {
    calls.links = vi.fn(async () => ({
      data: {
        data: [
          {
            id: "l1",
            tenantId: "t",
            from: { type: "journal_entry", id: ENTRY },
            to: { type: "document", id: DOC },
            kind: "justifies",
            allocatedAmount: "300.00",
            currency: "SEK",
            note: null,
            createdAt: new Date(),
            createdBy: "u",
            source: "web",
            otherLabel: "exp_20260302_001 · 300.00 SEK",
          },
        ],
      },
    }));
    calls.search = vi.fn(async () => ({
      data: {
        data: [
          {
            type: "document",
            id: DOC,
            label: "exp_20260302_002",
            amount: "200.00",
            currency: "SEK",
            remaining: "200.00",
          },
        ],
      },
    }));
    calls.linkEntry = vi.fn(async () => ({ data: { data: { id: "l2" } } }));
    const onChanged = vi.fn();
    render(<EntryLinks entry={manual} canWrite onChanged={onChanged} />);
    expect(await screen.findByText("exp_20260302_001 · 300.00 SEK")).toBeInTheDocument();
    expect(calls.links).toHaveBeenCalledWith({ type: "journal_entry", id: ENTRY });

    fireEvent.click(screen.getByTestId("journal-link-to"));
    fireEvent.change(screen.getByTestId("journal-link-search"), { target: { value: "exp" } });
    await waitFor(() => expect(screen.getAllByTestId("journal-link-hit")).toHaveLength(1));
    // only the targets a manual entry may take: documents and client invoices
    expect(calls.search).toHaveBeenCalledWith({ q: "exp", types: ["document", "invoice"] });
    fireEvent.click(screen.getByTestId("journal-link-hit-link"));
    await waitFor(() =>
      expect(calls.linkEntry).toHaveBeenCalledWith({
        id: ENTRY,
        to: { type: "document", id: DOC },
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("a bank entry points to its bank row and offers no Link to…", () => {
    render(
      <EntryLinks
        entry={{ id: ENTRY, sourceType: "bank_transaction", sourceId: TX, currency: "SEK" }}
        canWrite
      />,
    );
    expect(screen.getByTestId("journal-open-transaction")).toHaveAttribute(
      "href",
      `/banking?open=${TX}`,
    );
    expect(screen.queryByTestId("journal-link-to")).not.toBeInTheDocument();
    expect(calls.links).not.toHaveBeenCalled(); // nothing loaded: its links are its transaction's
  });

  it("the accountant reads the links, with no Link to… and no Unlink", async () => {
    calls.links = vi.fn(async () => ({
      data: {
        data: [
          {
            id: "l1",
            tenantId: "t",
            from: { type: "journal_entry", id: ENTRY },
            to: { type: "document", id: DOC },
            kind: "justifies",
            allocatedAmount: null,
            currency: null,
            note: null,
            createdAt: new Date(),
            createdBy: "u",
            source: "web",
            otherLabel: "exp_20260302_001",
          },
        ],
      },
    }));
    render(<EntryLinks entry={manual} canWrite={false} />);
    expect(await screen.findByText("exp_20260302_001")).toBeInTheDocument();
    expect(screen.queryByTestId("journal-link-to")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unlink")).not.toBeInTheDocument();
  });
});
