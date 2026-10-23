// The flags on screen (F71): the D40 money format and key chip, while the words notes.md prints stay out of sight
// (they are the title, for a hover). The generators' bytes are pinned in generators.pure.test.ts.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { PackageFlag } from "@/modules/package/types";
import { FlagList } from "./flag-list";

const exact = { normalizer: (t: string) => t }; // keep U+202F / U+2212 (lessons, F39)

const flags: PackageFlag[] = [
  {
    kind: "unlinked_row",
    entity: "bank_transaction",
    id: "t1",
    key: "Plusgirokonto SEK 2026-06-27 -1198.52 SEK",
    detail: "OPENAI *CHATGPT",
    amount: "-1198.52",
    currency: "SEK",
    account: "Plusgirokonto SEK",
    date: "2026-06-27",
  },
  {
    kind: "delta",
    entity: "bank_transaction",
    id: "t2",
    key: "Plusgirokonto CHF 2026-06-25 1200.00 CHF",
    detail: "allocated 1000.00 CHF, 200.00 CHF open",
    amount: "200.00",
    currency: "CHF",
    account: "Plusgirokonto CHF",
    date: "2026-06-25",
  },
  {
    kind: "unpaid_invoice",
    entity: "invoice",
    id: "i1",
    key: "VA26-INV-002",
    detail: "partially paid, 24000.00 CHF open",
    amount: "24000.00",
    currency: "CHF",
  },
  {
    kind: "missing_document",
    entity: "expense",
    id: "e1",
    key: "Ex213-Tr-01",
    detail: "Train Zürich",
  },
  {
    kind: "document_not_ready",
    entity: "settlement",
    id: "s1",
    key: "ST26-001",
    detail: "the reimbursement statement has not been rendered yet",
  },
];

describe("FlagList (F71)", () => {
  afterEach(cleanup);

  it("groups by kind in notes.md's order, money through formatMoney, keys as chips", () => {
    render(<FlagList flags={flags} />);
    const list = screen.getByTestId("package-flag-list");
    expect(
      within(list)
        .getAllByText(/^(Missing|Unlinked|Deltas|Invoices|Documents)/)
        .map((e) => e.textContent),
    ).toEqual([
      "Missing documents",
      "Unlinked bank lines",
      "Deltas beyond tolerance",
      "Invoices issued but unpaid",
      "Documents not rendered yet",
    ]);
    // a bank line: its account and day, the signed amount, its text — not the raw label
    expect(
      screen.getByText("\u22121\u202F198.52\u00A0SEK · OPENAI *CHATGPT", exact),
    ).toBeInTheDocument();
    expect(screen.getByText("Plusgirokonto SEK 2026-06-27")).toBeInTheDocument();
    // the open amounts
    expect(screen.getByText("200.00\u00A0CHF open", exact)).toBeInTheDocument();
    expect(screen.getByText("24\u202F000.00\u00A0CHF open", exact)).toBeInTheDocument();
    // keys as code chips; a document not rendered says no more than its section
    expect(screen.getByText("VA26-INV-002").tagName).toBe("CODE");
    expect(screen.getByText("Ex213-Tr-01").tagName).toBe("CODE");
    expect(screen.getByText("Train Zürich")).toBeInTheDocument();
    expect(screen.queryByText(/has not been rendered yet/)).toBeNull();
    // no figure in notes.md's format on screen
    expect(list.textContent).not.toContain("-1198.52");
    expect(list.textContent).not.toContain("24000.00");
  });

  it("says so when nothing is flagged", () => {
    render(<FlagList flags={[]} />);
    expect(screen.getByTestId("package-flag-list")).toHaveTextContent("Nothing to ask about");
  });
});
