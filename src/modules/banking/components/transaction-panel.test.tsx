// The work surface (F131, review 2026-10-31 §6.2; D76): the detail view shows the row as a hero and three
// numbered steps — proof · partner · category — with *As the bank said* and *History* as collapsed footers; the
// row line carries the bank's facts;
// the panel opens at the work surface's default width. Invented rows (D51). The linking components the zones
// host are stubbed: this file tests the arrangement, their own tests test them.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TransactionDetailWire } from "@/modules/banking/detail-wire";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/banking/banking.actions", () => ({
  getTransactionAction: "getTransaction",
  acceptTransferAction: "acceptTransfer",
  getTransactionHistoryAction: "history",
  categoriseTransactionAction: "categorise",
}));
vi.mock("@/modules/linking/ui", () => ({
  JustifyPanel: ({ heading }: { heading?: boolean }) => (
    <div data-testid="justify-panel" data-heading={String(heading ?? true)}>
      justify
    </div>
  ),
  LinksList: ({ links }: { links: unknown[] }) => (
    <div data-testid="links-list">{links.length} links</div>
  ),
  SuggestionsSection: () => <div data-testid="suggestions">suggestions</div>,
  ProposalLine: () => null,
  GraphLink: () => <a href="/graph">Graph</a>,
  prefillFromProposals: () => ({}),
  useRowProposals: () => ({ proposals: [] }),
}));
vi.mock("@/modules/settings/ui", () => ({
  BasPicker: ({ id, value }: { id?: string; value: string }) => (
    <select id={id} value={value} onChange={() => {}}>
      <option value="">—</option>
    </select>
  ),
}));
vi.mock("./rule-dialog", () => ({ RuleDialog: () => null }));
// US7 (F183): the subscription line self-loads — its own test is subscriptions' (subscription-match.test.tsx)
vi.mock("@/modules/subscriptions/ui", () => ({ SubscriptionRowMatch: () => null }));

let detail: TransactionDetailWire;
const sheetProps: Record<string, unknown>[] = [];
// one stable function per action, like the real hook (the view reloads when `executeAsync` changes)
const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () =>
      action === "getTransaction" ? { data: { data: detail } } : { data: { data: [] } },
    );
    return { executeAsync: calls[action], isPending: false };
  },
}));
// the kit's docked panel is tested in the kernel; here only the width the page asks for
vi.mock("@/components/ui/sheet", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/sheet")>("@/components/ui/sheet");
  return {
    ...actual,
    SheetContent: (props: Record<string, unknown>) => {
      sheetProps.push(props);
      return <div data-testid="transaction-panel">{props.children as never}</div>;
    },
  };
});

import { TransactionDetailView, TransactionPanel, WORK_SURFACE_WIDTH } from "./transaction-panel";

const ROW = "11111111-1111-4111-8111-111111111111";
const now = "2026-07-08T10:00:00.000Z";

function makeDetail(over: Partial<TransactionDetailWire> = {}): TransactionDetailWire {
  return {
    transaction: {
      id: ROW,
      tenantId: "t",
      bankAccountId: "acc",
      bankImportId: "imp",
      bookingDate: "2026-07-08",
      amount: "-1297.20",
      currency: "SEK",
      balance: "10000.00",
      sender: null,
      recipient: null,
      name: "SKATTEPUNKTEN OFFICE",
      additionalDetails: null,
      message: "Invoice 2026-071",
      ownNotes: null,
      description: "SKATTEPUNKTEN OFFICE",
      reference: "2026-071",
      counterpartyKey: "SKATTEPUNKTEN OFFICE",
      dedupHash: "h",
      occurrence: 1,
      rowIndex: 3,
      amountBase: "-1297.20",
      rate: "1",
      rateSource: "same_currency",
      rateDate: null,
      basCode: null,
      partnerId: null,
      note: null,
      noDocumentNeeded: false,
      categorisedBy: null,
      ruleId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "u",
      source: "import",
      bankImplicitRate: null,
    },
    accountLabel: "Plusgirokonto SEK",
    state: "open",
    effective: {
      partnerId: null,
      partnerFrom: null,
      basCode: null,
      basFrom: null,
      mixed: false,
      partnerName: null,
      basLabel: null,
    },
    allocated: "0",
    links: [],
    transfers: [],
    import: {
      id: "imp",
      tenantId: "t",
      bankAccountId: "acc",
      fileName: "nordea-2026-07.csv",
      documentId: null,
      recordCount: 31,
      duplicateCount: 0,
      errorCount: 0,
      importedAt: now,
      importedBy: "u",
      status: "done",
      periodFrom: "2026-07-01",
      periodTo: "2026-07-31",
    } as unknown as TransactionDetailWire["import"],
    ...over,
  };
}

const options = {
  categories: [{ code: "6540", label: "6540 · IT-tjänster" }],
  partners: [{ id: "p1", name: "Skattepunkten Office Services AB", defaultBasCode: "6540" }],
  justifyOptions: { groups: [], categories: [], partners: [] },
};

function renderView(d: TransactionDetailWire, canWrite = true) {
  detail = d;
  return render(
    <TransactionDetailView
      transactionId={ROW}
      categories={options.categories}
      partners={options.partners}
      justifyOptions={options.justifyOptions}
      canWrite={canWrite}
      header={(title, description) => (
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      )}
    />,
  );
}

afterEach(() => {
  cleanup();
  sheetProps.length = 0;
});

describe("the work surface — the hero, three steps and two collapsed footers (D76)", () => {
  it("an open row: 1 · Proof (the Justify panel, the candidates) · 2 · Partner · 3 · Category (the form), each marked", async () => {
    renderView(makeDetail());
    await screen.findByTestId("zone-proof");
    const steps = [...document.querySelectorAll("[data-step]")];
    expect(steps.map((z) => [z.getAttribute("data-step"), z.getAttribute("data-status")])).toEqual([
      ["proof", "missing"],
      ["partner", "missing"],
      ["category", "missing"],
    ]);
    expect(screen.getByRole("heading", { name: /^1 · Proof/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^2 · Partner/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^3 · Category/ })).toBeInTheDocument();
    expect(screen.getByTestId("panel-verdict")).toHaveTextContent("3 of 3 still missing.");

    const proof = screen.getByTestId("zone-proof");
    expect(within(proof).getByTestId("justify-panel")).toBeInTheDocument();
    // the zone's step is the heading: the panel takes no section of its own (T024)
    expect(within(proof).getByTestId("justify-panel")).toHaveAttribute("data-heading", "false");
    expect(within(proof).getByTestId("suggestions")).toBeInTheDocument();
    expect(within(proof).queryByTestId("links-list")).toBeNull(); // nothing linked: no list

    const facts = screen.getByTestId("zone-facts");
    expect(within(facts).getByLabelText("Partner")).toBeInTheDocument();
    expect(within(facts).getByLabelText("Category")).toBeInTheDocument();
    expect(within(facts).getByLabelText("Note")).toBeInTheDocument();
    expect(within(facts).getByTestId("create-rule")).toBeInTheDocument();
  });

  it("the row line carries the bank's facts: the counterparty, the reference, the base at its rate", async () => {
    renderView(makeDetail());
    const row = await screen.findByTestId("zone-row");
    expect(within(row).getByText("SKATTEPUNKTEN OFFICE")).toBeInTheDocument();
    expect(within(row).getByTestId("row-reference")).toHaveTextContent("2026-071");
    // D40 money: U+2212 minus, U+202F thousands, the code after
    expect(within(row).getByTestId("row-base")).toHaveTextContent(/−1\s297\.20 SEK at 1 \(/);
    // the hero: the amount large, the state with its sentence
    expect(screen.getByTestId("panel-amount")).toHaveTextContent(/^−1\s297\.20 SEK$/);
    expect(screen.getByTestId("panel-state")).toHaveTextContent("Open");
  });

  it("As the bank said and History are footers, closed by default; a click opens the raw row", async () => {
    renderView(makeDetail());
    const raw = await screen.findByRole("button", { name: "As the bank said" });
    const history = screen.getByRole("button", { name: "History" });
    expect(raw).toHaveAttribute("aria-expanded", "false");
    expect(history).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("nordea-2026-07.csv")).not.toBeVisible();
    fireEvent.click(raw);
    expect(raw).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("nordea-2026-07.csv")).toBeVisible();
    // the footers come after the steps
    const zones = [...document.querySelectorAll("[data-step]")];
    expect(
      zones[zones.length - 1]?.compareDocumentPosition(raw) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("a linked row: the links list in the proof zone, no Justify panel; the facts say where the partner comes from", async () => {
    renderView(
      makeDetail({
        state: "linked",
        allocated: "1297.20",
        links: [
          {
            id: "l1",
            tenantId: "t",
            from: { type: "bank_transaction", id: ROW },
            to: { type: "supplier_invoice", id: "si1" },
            kind: "justifies",
            allocatedAmount: "1297.20",
            currency: "SEK",
            allocatedBase: "1297.20",
            note: null,
            createdAt: now,
            createdBy: "u",
            source: "ui",
            otherLabel: "SI26-004 · Skattepunkten",
            documents: [],
          },
        ],
        effective: {
          partnerId: "p1",
          partnerFrom: "proof",
          basCode: "6540",
          basFrom: "proof",
          mixed: false,
          partnerName: "Skattepunkten Office Services AB",
          basLabel: "6540 · IT-tjänster",
        },
      }),
    );
    const proof = await screen.findByTestId("zone-proof");
    expect(within(proof).queryByTestId("justify-panel")).toBeNull();
    expect(within(proof).getByTestId("links-list")).toHaveTextContent("1 links");
    expect(within(proof).getByTestId("suggestions")).toBeInTheDocument();
    const facts = screen.getByTestId("zone-facts");
    expect(within(facts).getByTestId("effective-partner")).toHaveTextContent(
      "Skattepunkten Office Services AB",
    );
    expect(within(facts).getByTestId("effective-partner")).toHaveTextContent("from the proof");
    expect(within(facts).getByTestId("effective-category")).toHaveTextContent("6540");
    // the owner, 2026-11-09: each step holds its own control — the partner in 2, the category and note in 3
    expect(
      within(screen.getByTestId("step-partner")).getByLabelText("Partner"),
    ).toBeInTheDocument();
    const category = screen.getByTestId("step-category");
    expect(within(category).getByLabelText("Category")).toBeInTheDocument();
    expect(within(category).getByLabelText("Note")).toBeInTheDocument();
    expect(within(category).queryByLabelText("Partner")).toBeNull();
  });

  it("a row the statement proves (a savings row, no link): the proof zone says so and offers no candidates", async () => {
    renderView(
      makeDetail({
        state: "no_document",
        accountLabel: "Sparkonto",
        effective: {
          partnerId: null,
          partnerFrom: null,
          basCode: null,
          basFrom: null,
          mixed: false,
          partnerName: null,
          basLabel: null,
        },
      }),
    );
    const proof = await screen.findByTestId("zone-proof");
    expect(within(proof).getByTestId("proof-none-needed")).toHaveTextContent(
      "The statement is the proof",
    );
    expect(within(proof).queryByTestId("suggestions")).toBeNull();
    expect(within(proof).queryByTestId("justify-panel")).toBeNull();
  });

  it("a flagged row with its partner: *no proof needed* in the proof zone", async () => {
    const d = makeDetail({ state: "no_document" });
    d.transaction.noDocumentNeeded = true;
    d.transaction.basCode = "6570";
    d.transaction.partnerId = "bank";
    renderView(d);
    const proof = await screen.findByTestId("zone-proof");
    expect(within(proof).getByTestId("proof-none-needed")).toHaveTextContent("No proof needed");
  });

  it("the panel asks the kit for the work surface's width (38 % of the canvas, D76)", async () => {
    detail = makeDetail();
    render(
      <TransactionPanel
        transactionId={ROW}
        onClose={() => {}}
        categories={options.categories}
        partners={options.partners}
        canWrite
      />,
    );
    await screen.findByTestId("zone-row");
    expect(WORK_SURFACE_WIDTH).toBe("38%");
    expect(sheetProps[0]?.defaultWidth).toBe("38%");
  });
});
