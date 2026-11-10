// *What it read* (F185): the rows, the count, the hover that picks the active field (its box on the page), the
// question of a field to check and its one-click answers, the edit in place, nothing writable for the accountant.
// Invented values (D51).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { type ReadField, WhatItRead } from "./read-fields";

afterEach(cleanup);

const FIELDS: ReadField[] = [
  {
    key: "vendorName",
    label: "Vendor",
    value: "Lindgren Kontorsservice AB",
    raw: "Lindgren Kontorsservice AB",
    input: "text",
    confidence: 0.99,
    sure: true,
    ask: null,
  },
  {
    key: "dueDate",
    label: "Due date",
    value: "2026-08-07",
    raw: "2026-08-07",
    input: "date",
    confidence: 0.72,
    sure: false,
    ask: { kind: "dateOrder", printed: "07-08", options: ["2026-08-07", "2026-07-08"] },
  },
  {
    key: "invoiceNumber",
    label: "Invoice #",
    value: "30418",
    raw: "30418",
    input: "text",
    confidence: 0.81,
    sure: false,
    ask: { kind: "confirm" },
  },
  {
    key: "totalTax",
    label: "VAT",
    value: "253.80 SEK",
    raw: "253.80",
    input: "amount",
    confidence: 0.6,
    sure: true,
    corrected: true,
    ask: null,
  },
];

function setup(canWrite = true) {
  const onActive = vi.fn();
  const onAnswer = vi.fn();
  render(
    <WhatItRead
      fields={FIELDS}
      active="dueDate"
      onActive={onActive}
      onAnswer={onAnswer}
      canWrite={canWrite}
    />,
  );
  const row = (key: string) =>
    screen
      .getAllByTestId("read-field")
      .find((r) => r.getAttribute("data-mark") === key) as HTMLElement;
  return { onActive, onAnswer, row };
}

describe("WhatItRead", () => {
  it("one row per field: the value, the confidence in its band, the owner's word as a check; N sure · M to check", () => {
    const { row } = setup();
    expect(screen.getByText("2 sure · 2 to check")).toBeInTheDocument();
    expect(within(row("vendorName")).getByTestId("read-field-confidence")).toHaveTextContent("99%");
    expect(within(row("vendorName")).getByTestId("read-field-confidence")).toHaveClass("text-read");
    expect(within(row("dueDate")).getByTestId("read-field-confidence")).toHaveClass(
      "text-state-attention",
    );
    expect(within(row("totalTax")).getByLabelText("Checked by you")).toBeInTheDocument();
    expect(row("dueDate")).toHaveAttribute("data-active", "true");
  });

  it("hovering or focusing a row makes it the active field (its box on the page)", () => {
    const { onActive, row } = setup();
    fireEvent.mouseEnter(row("invoiceNumber"));
    expect(onActive).toHaveBeenLastCalledWith("invoiceNumber");
    fireEvent.focus(within(row("vendorName")).getAllByRole("button")[0] as HTMLElement);
    expect(onActive).toHaveBeenLastCalledWith("vendorName");
  });

  it("an ambiguous date asks which, each answer one click", () => {
    const { onAnswer, row } = setup();
    const ask = within(row("dueDate")).getByTestId("read-field-ask");
    expect(ask).toHaveTextContent("“07-08” — Aug 7 or Jul 8?");
    fireEvent.click(within(ask).getByRole("button", { name: "2026-07-08" }));
    expect(onAnswer).toHaveBeenCalledWith("dueDate", "2026-07-08");
    expect(within(row("vendorName")).queryByTestId("read-field-ask")).not.toBeInTheDocument();
  });

  it("is it right? — Yes confirms the value; Change edits it in place, Enter keeps it, Escape drops it", () => {
    const { onAnswer, row } = setup();
    const r = row("invoiceNumber");
    expect(within(r).getByTestId("read-field-ask")).toHaveTextContent(
      "Read at 81 % — is it right?",
    );
    fireEvent.click(within(r).getByRole("button", { name: "Yes, it is" }));
    expect(onAnswer).toHaveBeenLastCalledWith("invoiceNumber", "30418");

    fireEvent.click(within(r).getByTestId("read-field-change"));
    const input = within(r).getByTestId("read-field-input");
    fireEvent.change(input, { target: { value: "30419" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAnswer).toHaveBeenLastCalledWith("invoiceNumber", "30419");

    fireEvent.click(within(r).getByTestId("read-field-edit"));
    const again = within(r).getByTestId("read-field-input");
    fireEvent.change(again, { target: { value: "nope" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(within(r).queryByTestId("read-field-input")).not.toBeInTheDocument();
  });

  it("the accountant reads: the question, no answer, no edit", () => {
    const { row } = setup(false);
    expect(within(row("dueDate")).getByTestId("read-field-ask")).toBeInTheDocument();
    expect(within(row("dueDate")).queryByTestId("read-field-answer")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("read-field-edit")).toHaveLength(0);
  });
});
