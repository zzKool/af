// F125: the BAS picker as the owner uses it — open, see the suggestion on top with its source, type to narrow, pick.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { BasOption } from "../types";
import { BasPicker } from "./bas-picker";

const opt = (code: string, name: string, nameSv: string, alias: string | null, fav = false) =>
  ({
    code,
    label: `${code} · ${name}${alias ? ` (${alias})` : ""}`,
    name,
    nameSv,
    alias,
    classNum: Number(code[0]),
    favourite: fav,
  }) satisfies BasOption;

const OPTIONS = [
  opt("153", "Contractual receivables", "Kontraktsfordringar", "Kund"),
  opt("501", "Premises rent", "Lokalhyra", "Lokal", true),
  opt("653", "Accounting services", "Redovisningstjänster", "Acc"),
  opt("654", "IT services", "IT-tjänster", "IT"),
  opt("657", "Bank charges", "Bankkostnader", null),
];

function open(testId = "bas") {
  fireEvent.click(screen.getByTestId(testId));
}

describe("BasPicker", () => {
  afterEach(cleanup);

  it("shows the account in English with the short code; empty shows the placeholder", () => {
    const { rerender } = render(
      <BasPicker options={OPTIONS} value="654" onChange={vi.fn()} data-testid="bas" />,
    );
    expect(screen.getByTestId("bas")).toHaveTextContent("654IT servicesIT");
    rerender(
      <BasPicker
        options={OPTIONS}
        value=""
        onChange={vi.fn()}
        placeholder="Pick one"
        data-testid="bas"
      />,
    );
    expect(screen.getByTestId("bas")).toHaveTextContent("Pick one");
  });

  it("the suggestion on top says where it comes from; English only, the Swedish name a tooltip (D72)", async () => {
    render(
      <BasPicker
        options={OPTIONS}
        value=""
        onChange={vi.fn()}
        suggestions={[{ code: "654", source: "partner" }]}
        direction="cost"
        data-testid="bas"
      />,
    );
    open();
    const suggested = await screen.findByText("Suggested");
    expect(suggested).toBeInTheDocument();
    const it654 = screen.getByTestId("bas-option-654");
    expect(it654).toHaveTextContent("the supplier's default");
    expect(it654).not.toHaveTextContent("IT-tjänster");
    expect(it654).toHaveAttribute("title", "IT-tjänster");
    // the favourite comes next, then the cost classes
    const labels = screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"));
    expect(labels.slice(0, 2)).toEqual(["654 · IT services (IT)", "501 · Premises rent (Lokal)"]);
  });

  it("typing narrows on a word in either language; a pick returns the code", async () => {
    const onChange = vi.fn();
    render(<BasPicker options={OPTIONS} value="" onChange={onChange} data-testid="bas" />);
    open();
    const search = await screen.findByPlaceholderText(/Search a number/);
    fireEvent.change(search, { target: { value: "redovisning" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("bas-option-653"));
    expect(onChange).toHaveBeenCalledWith("653");
  });

  it("the owner's Use for note is the second line, and a word of it finds the account (F126)", async () => {
    const withNote = OPTIONS.map((o) =>
      o.code === "654" ? { ...o, useFor: "Software licences and cloud subscriptions" } : o,
    );
    render(<BasPicker options={withNote} value="" onChange={vi.fn()} data-testid="bas" />);
    open();
    expect(await screen.findByTestId("bas-option-654")).toHaveTextContent(
      "Software licences and cloud subscriptions",
    );
    fireEvent.change(screen.getByPlaceholderText(/Search a number/), {
      target: { value: "licences" },
    });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByTestId("bas-option-654")).toBeInTheDocument();
  });

  it("where the field keys an entry, an account without a short code is shown disabled with the reason", async () => {
    render(
      <BasPicker options={OPTIONS} value="" onChange={vi.fn()} requireAlias data-testid="bas" />,
    );
    open();
    const fee = await screen.findByTestId("bas-option-657");
    expect(fee).toHaveAttribute("data-disabled");
    expect(within(fee).getByText(/no short code/)).toBeInTheDocument();
  });

  it("allowNone: a first choice clears the field", async () => {
    const onChange = vi.fn();
    render(
      <BasPicker
        options={OPTIONS}
        value="654"
        onChange={onChange}
        allowNone
        noneLabel="No category"
        data-testid="bas"
      />,
    );
    open();
    fireEvent.click(await screen.findByTestId("bas-option-none"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("a code no longer active keeps its label", () => {
    render(
      <BasPicker
        options={OPTIONS}
        value="580"
        onChange={vi.fn()}
        fallbackLabel="580 · Travel expenses"
        data-testid="bas"
      />,
    );
    expect(screen.getByTestId("bas")).toHaveTextContent("580Travel expenses");
  });
});
