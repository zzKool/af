import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { EditorDraft } from "./invoice-editor";

// F143, the studio: *Ready to send?* follows the editor's draft, *When will it be paid?* the client's history;
// the reminder card opens on the drafted text in the document's language.
let draft: EditorDraft;
vi.mock("./invoice-editor", () => ({
  InvoiceEditor: ({ onDraft }: { onDraft: (d: EditorDraft) => void }) => {
    useEffect(() => onDraft(draft), [onDraft]);
    return <div data-testid="editor" />;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { InvoiceStudio } from "./invoice-studio";
import { ReminderCard } from "./reminder-card";

afterEach(cleanup);

const base: EditorDraft = {
  language: "en",
  periodLabel: "2026 July",
  issueDate: "2026-08-01",
  printedReferences: [],
  lines: [{ description: "Consulting", quantity: "20", unitPrice: "1200", vatRate: "0" }],
  registration: {
    id: "r1",
    country: "CH",
    vatNumber: "CHE-000.000.000 MWST",
    rateSchedule: [],
  } as never,
  treatment: "export",
  total: "24000",
};

function studio(history: { days: number }[] = []) {
  return render(
    <InvoiceStudio
      invoice={{ type: "invoice", currency: "CHF", language: "en" } as never}
      parties={{} as never}
      numberHint={null}
      relatedNumber={null}
      registrations={[]}
      partnerForVat={{ address: null, vatNumber: null }}
      partnerName="Invented Client SA"
      facts={{
        partnerShortCode: "IC",
        bank: { currency: "CHF", iban: "CH00 0000 0000 0000 0000 0" },
        rateKnown: true,
        history: history.map((h, i) => ({
          id: String(i),
          number: `IC26-INV-00${i + 1}`,
          issueDate: "2026-01-01",
          dueDate: "2026-01-31",
          paidOn: "2026-02-01",
          days: h.days,
          late: false,
        })),
      }}
      today="2026-08-01"
    />,
  );
}

describe("InvoiceStudio", () => {
  it("checks the draft — a line without days is to do", () => {
    draft = { ...base, lines: [{ ...base.lines[0], quantity: "0" }] };
    studio();
    const lines = screen
      .getAllByTestId("invoice-ready-item")
      .find((el) => el.dataset.key === "lines");
    expect(lines).toHaveAttribute("data-state", "todo");
    expect(screen.getByTestId("invoice-ready-count")).toHaveTextContent("5 of 6"); // no references asked: no line for them
  });

  it("says when the money should come from the client's history", () => {
    draft = base;
    studio([{ days: 28 }, { days: 31 }, { days: 30 }]);
    expect(screen.getByTestId("invoice-when-paid")).toHaveTextContent("in 28–31 days");
  });

  it("has nothing to go by without a paid invoice", () => {
    draft = base;
    studio();
    expect(screen.getByTestId("invoice-when-paid")).toHaveTextContent("No paid invoice");
  });
});

describe("ReminderCard", () => {
  it("shows the reminder in the document's language", () => {
    render(
      <ReminderCard
        facts={{
          number: "IC26-INV-008",
          issueDate: "2026-07-01",
          dueDate: "2026-07-31",
          open: "CHF 9'600.00",
          clientName: "Invented Client SA",
          companyName: "Invented AB",
          ownerName: null,
        }}
        language="fr"
        today="2026-08-08"
        email="ap@invented.example"
      />,
    );
    expect(screen.getByTestId("invoice-reminder")).toHaveTextContent("8 day(s) late");
    fireEvent.click(screen.getByTestId("invoice-reminder-toggle"));
    expect(screen.getByTestId("invoice-reminder-body")).toHaveTextContent("reste ouvert");
    expect(screen.getByRole("link", { name: "Open in mail" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:ap@invented.example?subject="),
    );
  });
});

describe("the days calendar's month (F160)", () => {
  it("reads the period label in en, fr, sv or ISO; nothing else", async () => {
    const { monthOfPeriod, weekdaysOf } = await import("./invoice-studio");
    expect(monthOfPeriod("2026 October")).toBe("2026-10");
    expect(monthOfPeriod("Juillet 2026")).toBe("2026-07");
    expect(monthOfPeriod("augusti 2026")).toBe("2026-08");
    expect(monthOfPeriod("2026-03")).toBe("2026-03");
    expect(monthOfPeriod("Q3 2026")).toBeNull();
    expect(monthOfPeriod("")).toBeNull();
    expect(weekdaysOf("2026-07")).toHaveLength(23);
  });
});

describe("the days the calendar opens with (F168)", () => {
  it("stored days win; else a whole quantity suggests the month's first weekdays; else none", async () => {
    const { daysToShow } = await import("./invoice-studio");
    expect(daysToShow(["2026-07-06", "2026-07-08"], "2", "2026-07")).toEqual({
      days: ["2026-07-06", "2026-07-08"],
      suggested: false,
    });
    // July 2026 starts on a Wednesday
    expect(daysToShow([], "3", "2026-07")).toEqual({
      days: ["2026-07-01", "2026-07-02", "2026-07-03"],
      suggested: true,
    });
    expect(daysToShow([], "4.5", "2026-07")).toEqual({ days: [], suggested: false });
    expect(daysToShow([], "0", "2026-07")).toEqual({ days: [], suggested: false });
    expect(daysToShow([], "40", "2026-07")).toEqual({ days: [], suggested: false });
  });
});
