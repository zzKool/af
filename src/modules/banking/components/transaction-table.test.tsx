// The list beside the work surface (F131, review 2026-10-31 §6.2, read by the owner; D76 the Pulse board): a fresh
// user sees five columns — Date · Counterparty · proof · partner · category · State · Amount — in that order; Account, Description, Category, Partner, Proposed
// and Note wait in the column chooser; a saved layout wins. Invented rows (D51). The panel and the Months panel are
// not the point here and are stubbed.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { TablePreferencesProvider } from "@/kernel/ui/data-table/preferences";
import { DockedCanvas } from "@/kernel/ui/shell/details-dock";
import type { TransactionRow } from "./transaction-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/banking",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/modules/banking/banking.actions", () => ({
  distinctTransactionsAction: vi.fn(async () => ({ data: { data: [] } })),
  transactionDateHierarchyAction: vi.fn(async () => ({ data: { data: { years: [], empty: 0 } } })),
}));
vi.mock("@/modules/linking/ui", () => ({
  ProposedCode: ({ code }: { code: string }) => <span>{code}</span>,
}));
vi.mock("./transaction-panel", () => ({ TransactionPanel: () => null }));
vi.mock("./months-panel", () => ({ MonthsPanel: () => null }));
vi.mock("./day-strip", () => ({ DayStrip: () => null }));

const { TransactionTable } = await import("./transaction-table");

const row: TransactionRow = {
  id: "11111111-1111-4111-8111-111111111111",
  bankAccountId: "acc-1",
  accountLabel: "Plusgirokonto SEK",
  bankImportId: "imp-1",
  bookingDate: "2026-07-08",
  description: "Kortköp 260708 SKATTEPUNKTEN OFFICE",
  counterpartyKey: "SKATTEPUNKTEN OFFICE",
  amount: "-1297.20",
  currency: "SEK",
  balance: "48102.80",
  reference: null,
  ownNotes: null,
  amountBase: "1297.20",
  rate: "1",
  rateSource: "same_currency",
  bankImplicitRate: null,
  basCode: "6540",
  basLabel: "6540 IT-tjänster",
  basFrom: "row",
  partnerId: "p-1",
  partnerName: "Skattepunkten AB",
  partnerFrom: "row",
  mixed: false,
  proposedBasCode: null,
  proposedSource: null,
  proposedConfidence: null,
  note: "a note",
  noDocumentNeeded: false,
  categorisedBy: "manual",
  state: "open",
  allocated: "0.00",
  createdAt: "2026-07-09T08:00:00.000Z",
};

const headers = () =>
  Array.from(document.querySelectorAll("thead th[data-column]")).map((th) =>
    th.getAttribute("data-column"),
  );

function renderTable(initial: Record<string, unknown> = {}) {
  return render(
    <LocaleProvider initialLocale="en">
      <TablePreferencesProvider initial={initial} save={async () => undefined}>
        <DockedCanvas>
          <TransactionTable
            result={{ rows: [row], total: 1 }}
            balances={[]}
            accounts={[{ id: "acc-1", label: "Plusgirokonto SEK", currency: "SEK" }]}
            categories={[]}
            partners={[]}
            importLabels={{}}
            canWrite
          />
        </DockedCanvas>
      </TablePreferencesProvider>
    </LocaleProvider>,
  );
}

afterEach(cleanup);

describe("TransactionTable — the four columns beside the work surface (F131 §6.2)", () => {
  it("shows Date · Counterparty · the three dots · State · Amount by default, in that order, nothing else", () => {
    renderTable();
    expect(headers()).toEqual(["bookingDate", "counterpartyKey", "steps", "state", "amount"]);
    // D76: who in bold — the partner when there is one — with the bank's text under it (and as the tooltip)
    const who = screen.getByText("Skattepunkten AB");
    expect(who.parentElement).toHaveAttribute("title", "Kortköp 260708 SKATTEPUNKTEN OFFICE");
    expect(screen.getByText("Kortköp 260708 SKATTEPUNKTEN OFFICE")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /^Proof: missing · Partner: done · Category: done$/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("6540 IT-tjänster")).not.toBeInTheDocument();
  });

  it("Account, Description, Category, Partner, Proposed and Note wait in the chooser; one tick shows a column", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    const menu = screen.getByTestId("columns-menu");
    for (const name of ["Account", "Description", "Category", "Partner", "Proposed", "Note"]) {
      expect(menu.querySelector(`[aria-label="${name}"]`)).toHaveAttribute("aria-checked", "false");
    }
    for (const name of ["Date", "Amount", "Counterparty", "State", "Checks"]) {
      expect(menu.querySelector(`[aria-label="${name}"]`)).toHaveAttribute("aria-checked", "true");
    }
    fireEvent.click(menu.querySelector('[aria-label="Partner"]') as Element);
    expect(headers()).toEqual([
      "bookingDate",
      "counterpartyKey",
      "steps",
      "state",
      "amount",
      "partnerName",
    ]);
    expect(screen.getAllByText("Skattepunkten AB")).toHaveLength(2);
  });

  it("a saved layout wins over the defaults (its hidden list is the whole list, its order first)", () => {
    renderTable({
      "bank-transactions": {
        hidden: ["amount"],
        order: ["description", "bookingDate"],
        widths: {},
      },
    });
    const shown = headers();
    expect(shown.slice(0, 2)).toEqual(["description", "bookingDate"]);
    expect(shown).not.toContain("amount");
    expect(shown).toContain("partnerName");
    expect(screen.getAllByText("Skattepunkten AB").length).toBeGreaterThan(0);
  });
});
