// *This row refunds me* in the work surface (T021, review §5.1): the FIFO for the panel's row ticks the oldest
// claims the row's base reaches, a tick or a typed base changes what is sent, a line above what is open or a total
// above the row greys *Confirm*, and *Confirm* sends the row and the lines to the settlement action — the server
// writes and checks (its own tests in `settlements.test.ts`). Invented values (D51).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/modules/expenses/expenses.actions", () => ({
  openPrivateExpensesAction: "open",
  proposeSettlementAction: "propose",
  confirmSettlementAction: "confirm",
}));

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () => ({ data: { data: null } }));
    return { executeAsync: calls[action], isPending: false };
  },
}));

import { RefundPicker } from "./refund-picker";

const ROW = "11111111-1111-4111-8111-111111111111";
const SE = "33333333-3333-4333-8333-333333333333";
const claim = (id: string, key: string, date: string, base: string) => ({
  expenseId: id,
  key,
  date,
  description: `Receipt ${key}`,
  amountBase: base,
  openBase: base,
  paidFromAccountId: SE,
  currency: "SEK",
  amount: base,
  openAmount: base,
});
const open = [
  claim("e1", "Ex7-Tr-01", "2026-03-10", "600.00"),
  claim("e2", "Ex7-Tr-02", "2026-03-11", "400.00"),
  claim("e3", "Ex8-Rep-01", "2026-04-02", "250.00"),
];
// the row gives 1 000.00: the FIFO takes the two March claims
const proposal = {
  bankTransactionId: ROW,
  bookingDate: "2026-04-30",
  refundAmount: "1000.00",
  refundCurrency: "SEK",
  refundBase: "1000.00",
  paidFromAccountId: SE,
  lines: [
    { ...open[0], allocatedBase: "600.00", remainingOpen: "0.00" },
    { ...open[1], allocatedBase: "400.00", remainingOpen: "0.00" },
  ],
  allocatedBase: "1000.00",
  differenceBase: "0.00",
  roundingBase: "0.00",
  residualOpen: "0.00",
  unallocatedOnTransaction: "0.00",
};

function mount() {
  calls.open = vi.fn(async () => ({ data: { data: open } }));
  calls.propose = vi.fn(async () => ({ data: { data: proposal } }));
  calls.confirm = vi.fn(async () => ({ data: { data: { id: "s1", number: "ST26-004" } } }));
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<RefundPicker transactionId={ROW} onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel };
}

describe("RefundPicker — the FIFO in place (T021)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("proposes FIFO for the panel's row and confirms exactly the ticked lines with their base", async () => {
    const { onDone } = mount();
    await screen.findAllByTestId("refund-line");
    expect(calls.propose).toHaveBeenCalledWith({ bankTransactionId: ROW });
    expect(screen.getByRole("checkbox", { name: "Ex7-Tr-01" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Ex7-Tr-02" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Ex8-Rep-01" })).not.toBeChecked();
    expect(screen.getByTestId("refund-hint")).toHaveTextContent("Exact match");
    // the settle page stays one link away for the rest (the instrument, *in full*, the note)
    expect(screen.getByTestId("refund-open-settle")).toHaveAttribute(
      "href",
      `/expenses/settle?row=${ROW}`,
    );
    fireEvent.click(screen.getByTestId("refund-confirm"));
    await waitFor(() => expect(calls.confirm).toHaveBeenCalled());
    expect(calls.confirm.mock.calls[0][0]).toEqual({
      bankTransactionId: ROW,
      lines: [
        { expenseId: "e1", allocatedBase: "600.00" },
        { expenseId: "e2", allocatedBase: "400.00" },
      ],
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("a total above the row, or a line above what is open on it, greys Confirm and says why", async () => {
    mount();
    await screen.findAllByTestId("refund-line");
    fireEvent.click(screen.getByRole("checkbox", { name: "Ex8-Rep-01" }));
    expect(screen.getByTestId("refund-hint")).toHaveTextContent("250.00");
    expect(screen.getByTestId("refund-confirm")).toBeDisabled();
    // untick the train: 850.00 of 1 000.00 → 150.00 left on the row, Confirm enabled
    fireEvent.click(screen.getByRole("checkbox", { name: "Ex7-Tr-02" }));
    expect(screen.getByTestId("refund-confirm")).toBeEnabled();
    expect(screen.getByTestId("refund-hint")).toHaveTextContent("150.00");
    fireEvent.change(screen.getByRole("textbox", { name: "Allocate Ex8-Rep-01" }), {
      target: { value: "300.00" },
    });
    expect(screen.getByTestId("refund-hint")).toHaveTextContent("more than is open");
    expect(screen.getByTestId("refund-confirm")).toBeDisabled();
    expect(calls.confirm).not.toHaveBeenCalled();
  });

  it("Cancel writes nothing; a refusal of the proposal is shown in place", async () => {
    const { onCancel } = mount();
    await screen.findAllByTestId("refund-line");
    fireEvent.click(screen.getByTestId("refund-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(calls.confirm).not.toHaveBeenCalled();
    cleanup();
    calls.open = vi.fn(async () => ({ data: { data: open } }));
    calls.propose = vi.fn(async () => ({
      data: {
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: "The row is incoming",
          retryable: false,
        },
      },
    }));
    render(<RefundPicker transactionId={ROW} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByTestId("refund-error")).toHaveTextContent("The row is incoming");
    expect(screen.getByTestId("refund-confirm")).toBeDisabled();
  });
});
