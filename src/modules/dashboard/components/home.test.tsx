// The home's components (F138): money through `formatMoney` (D40, the F71 checks carried over), the priority as a
// state family, no palette colours; the three first moves and the rest on demand; the close's line for the owner;
// the cash's month and the currencies' exposure sentence. Invented figures (D51).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import type { ActionItem, CashSummary } from "../types";
import { yearWeeks } from "../year-weeks";
import { CashHero, CurrenciesCard, NextMoves } from "./home";
import { YearStrip } from "./year-strip";

afterEach(cleanup);

const item = (
  id: string,
  priority: ActionItem["priority"],
  extra?: Partial<ActionItem>,
): ActionItem => ({
  id,
  kind: "receipts_missing",
  count: 1,
  priority,
  href: "/expenses",
  ...extra,
});

const cash: CashSummary = {
  base: "SEK",
  total: "127500.00",
  monthDelta: "-2500.00",
  series: [
    { day: "2026-05-31", total: null },
    { day: "2026-06-30", total: "130000.00" },
    { day: "2026-07-15", total: "127500.00" },
  ],
  accounts: [
    { label: "Main CHF", currency: "CHF", balance: "9800.00", inBase: "122500.00", share: 96 },
    { label: "Main SEK", currency: "SEK", balance: "5000.00", inBase: "5000.00", share: 4 },
  ],
  exposure: [{ currency: "CHF", onePercent: "1225.00" }],
  incomplete: false,
};

describe("NextMoves", () => {
  it("money through formatMoney, the priority as a state family, no palette colours (F71)", () => {
    const { container } = render(
      <LocaleProvider initialLocale="fr-CH">
        <NextMoves
          items={[
            item("supplier-overdue", "high", {
              kind: "supplier_invoices_overdue",
              count: 3,
              amount: { value: "-12345.6", currency: "SEK" },
            }),
            item("receipts", "low"),
          ]}
          work={null}
        />
      </LocaleProvider>,
    );
    const [overdue, receipts] = screen.getAllByTestId("action-item");
    // U+2212 minus, U+202F thousands, the code after a no-break space — compared exactly
    expect(overdue?.textContent).toContain("−12 345.60 SEK");
    expect(overdue?.querySelector("svg.text-state-attention")).not.toBeNull();
    expect(receipts?.querySelector("svg.text-state-neutral")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/(bg|text)-(red|amber|green|yellow)-\d/);
    expect(screen.queryByTestId("home-close")).toBeNull();
  });

  it("the button says what you will do there, the first move is tinted — red only for something late", () => {
    render(
      <LocaleProvider initialLocale="en">
        <NextMoves
          items={[
            item("late", "high", { kind: "invoices_overdue", count: 1 }),
            item("rows", "high", { kind: "rows_to_justify", count: 6 }),
            item("docs", "medium", { kind: "documents_to_review", count: 1 }),
          ]}
          work={null}
        />
      </LocaleProvider>,
    );
    const [late, rows, docs] = screen.getAllByTestId("action-item");
    expect(late?.querySelector("a")?.textContent).toBe("Remind");
    expect(rows?.querySelector("a")?.textContent).toBe("Justify");
    expect(docs?.querySelector("a")?.textContent).toBe("Review");
    // the words agree with the count — never `(s)`
    expect(late?.textContent).toContain("1 client invoice overdue");
    expect(rows?.textContent).toContain("6 bank lines to justify");
    expect(docs?.textContent).toContain("1 document to review");
    expect(late?.hasAttribute("data-first")).toBe(true);
    expect(late?.className).toContain("border-destructive/30");
    expect(rows?.className).not.toContain("destructive");
  });

  it("a first move that is not late is amber, not red", () => {
    render(
      <LocaleProvider initialLocale="en">
        <NextMoves
          items={[item("rows", "high", { kind: "rows_to_justify", count: 2 })]}
          work={null}
        />
      </LocaleProvider>,
    );
    const first = screen.getByTestId("action-item");
    expect(first.className).toContain("border-state-attention/30");
    expect(first.className).not.toContain("destructive");
  });

  it("three moves first, the others on demand", () => {
    render(
      <LocaleProvider initialLocale="en">
        <NextMoves items={["a", "b", "c", "d", "e"].map((id) => item(id, "medium"))} work={null} />
      </LocaleProvider>,
    );
    expect(screen.getAllByTestId("action-item")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("home-moves-more"));
    expect(screen.getAllByTestId("action-item")).toHaveLength(5);
  });
});

describe("CashHero", () => {
  it("the total, the month's move, the year's figures through formatMoney", () => {
    render(
      <LocaleProvider initialLocale="sv-SE">
        <CashHero
          cash={cash}
          sentence="Nothing is late."
          metrics={[
            {
              id: "receivables:CHF",
              kind: "receivables",
              label: "receivables",
              value: "10810.00",
              currency: "CHF",
              hint: "1",
              href: "/invoices",
            },
          ]}
          year={{ year: "2026", justified: 30, toJustify: 10 }}
        />
      </LocaleProvider>,
    );
    // F158: the headline in whole units (the board: 693 295 SEK)
    expect(screen.getByTestId("home-cash-total").textContent).toBe("127 500");
    expect(screen.getByTestId("home-cash-month").textContent).toBe("▼ 2 500 this month");
    // F167: the hero's figures as the board prints them (10 810, 1.28 M)
    expect(screen.getByRole("link").textContent).toBe("10.8 k CHF");
    expect(screen.getByTestId("home-ring").textContent).toContain("75%");
  });
});

describe("CurrenciesCard", () => {
  it("each account's share and what a 1 % move is worth", () => {
    render(
      <LocaleProvider initialLocale="en">
        <CurrenciesCard
          cash={cash}
          tickers={[{ currency: "CHF", now: "12.500000", change: -1.2, points: ["12.65", "12.5"] }]}
          days={90}
        />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("home-ticker").textContent).toContain("−1.2 %");
    expect(screen.getByTestId("home-exposure").textContent).toContain("Main CHF 96 %");
    expect(screen.getByTestId("home-exposure").textContent).toContain(
      "A 1 % move in CHF/SEK is worth ± 1 225.00 SEK to you today.",
    );
  });
});

describe("YearStrip (F158, F171, F181)", () => {
  const today = "2026-11-11";
  const data = yearWeeks(
    [{ id: "a", label: "Main SEK", currency: "SEK" }],
    [
      {
        date: "2026-11-10",
        bankAccountId: "a",
        rows: 2,
        toJustify: 1,
        inBase: "100.00",
        outBase: "0.00",
      },
    ],
    today,
    {
      invoices: [
        { date: "2026-11-09", cell: "done" },
        { date: "2026-11-10", cell: "late" },
      ],
      expenses: [{ date: "2026-11-11", cell: "done" }],
      documents: [],
      subscriptions: [
        { date: "2026-11-10", cell: "done" },
        { date: "2026-11-14", cell: "open" },
      ],
    },
  );

  it("the bank's row, then invoices, expenses, documents and subscriptions; the week says what is in it", () => {
    const { container } = render(
      <LocaleProvider initialLocale="en">
        <YearStrip data={data} base="SEK" />
      </LocaleProvider>,
    );
    expect(screen.getAllByTestId("home-year-week")).toHaveLength(52);
    expect(screen.getAllByTestId("home-year-lane").map((l) => l.textContent)).toEqual([
      "Invoices",
      "Expenses",
      "Documents",
      "Subscriptions",
    ]);
    const states = (lane: string) =>
      [...container.querySelectorAll(`span[data-lane="${lane}"][data-state]`)].map((c) =>
        c.getAttribute("data-state"),
      );
    expect(states("invoices")).toHaveLength(52);
    expect(states("invoices").at(-1)).toBe("late");
    expect(states("expenses").at(-1)).toBe("done");
    expect(states("documents").every((s) => s === "none")).toBe(true);
    expect(states("subscriptions")).toHaveLength(52);
    expect(states("subscriptions").at(-1)).toBe("open");
    // the last busy week is picked: its books, the lanes without a thing left out
    const books = screen.getByTestId("home-year-books");
    expect(books.textContent).toContain("2 invoices issued · 1 not paid yet");
    expect(books.textContent).toContain("1 expense, all settled and justified");
    expect(books.querySelector('[data-lane="documents"]')).toBeNull();
    expect(books.querySelector('[data-lane="subscriptions"]')?.textContent).toBe(
      "2 subscription charges expected · 1 not charged or justified yet",
    );
    expect(screen.getByTestId("home-year-detail").textContent).toContain(
      "1 of 2 bank rows still to justify.",
    );
    expect(container.innerHTML).not.toMatch(/(bg|text)-(red|amber|green|yellow)-\d/);
  });

  it("an earlier week shows its own books", () => {
    render(
      <LocaleProvider initialLocale="en">
        <YearStrip data={data} base="SEK" />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getAllByTestId("home-year-week")[50] as HTMLElement);
    expect(screen.queryByTestId("home-year-books")).toBeNull();
    expect(screen.getByTestId("home-year-detail").textContent).toContain("No bank row that week.");
  });
});
