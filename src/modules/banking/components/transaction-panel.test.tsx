// The work surface (F131, review 2026-10-31 §6.2): the detail view shows three zones — the row · the proof ·
// the facts — with *As the bank said* and *History* as collapsed footers; the row line carries the bank's facts;
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
  JustifyPanel: () => <div data-testid="justify-panel">justify</div>,
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

describe("the work surface — three zones and two collapsed footers", () => {
  it("an open row: the row · the proof (the Justify panel, the candidates) · the facts, in that order", async () => {
    renderView(makeDetail());
    const zones = await screen.findAllByRole("region");
    expect(zones.map((z) => z.getAttribute("data-testid"))).toEqual([
      "zone-row",
      "zone-proof",
      "zone-facts",
    ]);
    expect(screen.getByRole("heading", { name: "The row" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The proof" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The facts" })).toBeInTheDocument();

    const proof = screen.getByTestId("zone-proof");
    expect(within(proof).getByTestId("justify-panel")).toBeInTheDocument();
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
    // the title line: date · amount · state; the account as a tag with the bank's text
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
    // the footers come after the zones
    const zones = screen.getAllByRole("region");
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

  it("the panel asks the kit for the work surface's width (55 % of the canvas)", async () => {
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
    expect(WORK_SURFACE_WIDTH).toBe("55%");
    expect(sheetProps[0]?.defaultWidth).toBe("55%");
  });
});
