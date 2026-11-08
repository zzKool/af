// Work's view (F137): the five steps on the line, the current step's card open first, another on a click, the
// invoice reminder, the past months with the streak, Also waiting in the dashboard's words. Invented facts (D51).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { translator } from "@/kernel/i18n/translate";
import { closeSteps } from "../close";
import type { MonthlyClose } from "../types";
import { leftSentence } from "../work-text";
import { MonthlyCloseView } from "./work-page";

afterEach(cleanup);

const facts = {
  month: "2026-07",
  rates: { weekdays: 23, missing: 0 },
  accounts: [{ label: "Main CHF", currency: "CHF", completeTo: "2026-07-31", complete: true }],
  rows: { justified: 35, toJustify: 6 },
  privateExpenses: 2,
  builtOn: null,
};
const close: MonthlyClose = {
  ...facts,
  ...closeSteps(facts),
  previous: "2026-06",
  next: "2026-08",
  reminders: [{ partnerId: "p1", partnerName: "Acme Consulting", lastIssueDate: "2026-07-02" }],
};

function view() {
  render(
    <LocaleProvider initialLocale="en">
      <MonthlyCloseView
        close={close}
        past={[
          { month: "2026-06", builtOn: "2026-07-04", percent: 100 },
          { month: "2026-05", builtOn: null, percent: 60 },
        ]}
        streak={1}
        alsoWaiting={[
          { id: "inv", kind: "invoices_overdue", count: 1, priority: "high", href: "/invoices" },
        ]}
      />
    </LocaleProvider>,
  );
}

describe("MonthlyCloseView", () => {
  it("opens on the current step: the rows, with what is left and the way to the bank rows", () => {
    view();
    const steps = [
      ...screen.getByTestId("work-steps").querySelectorAll<HTMLElement>("button[data-step]"),
    ];
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual([
      "done",
      "done",
      "current",
      "todo",
      "waiting",
    ]);
    const card = screen.getByTestId("work-step-card");
    expect(card.getAttribute("data-step")).toBe("justified");
    expect(card.textContent).toContain("6 bank row(s) of July 2026 still need");
    expect(within(card).getByRole("link", { name: "Continue — 6 left" }).getAttribute("href")).toBe(
      "/banking/reconcile?month=2026-07",
    );
  });

  it("another step's card on a click", () => {
    view();
    fireEvent.click(
      [
        ...screen.getByTestId("work-steps").querySelectorAll<HTMLElement>("button[data-step]"),
      ][3] as HTMLElement,
    );
    expect(screen.getByTestId("work-step-card").getAttribute("data-step")).toBe("expenses");
    expect(screen.getByTestId("work-step-card").textContent).toContain("2 added");
  });

  it("the reminder, Also waiting in the dashboard's words, the past months and the streak", () => {
    view();
    expect(screen.getByTestId("work-reminder").textContent).toContain(
      "Invoice Acme Consulting for July 2026 — not prepared yet",
    );
    expect(screen.getByTestId("work-also-item").textContent).toContain(
      "1 client invoice(s) overdue",
    );
    const months = screen.getAllByTestId("work-past-month");
    expect(months.map((m) => m.textContent)).toEqual([
      "Jun 2026closed 2026-07-04",
      "May 202660 % done",
    ]);
    expect(screen.getByTestId("work-streak").textContent).toBe("1 in a row");
  });
});

describe("leftSentence", () => {
  it("names what is left in a few words", () => {
    const t = translator("en");
    expect(leftSentence(close, "July 2026", t)).toBe(
      "3 step(s) left: 6 bank row(s) to justify, your private expenses, the package.",
    );
  });
});
