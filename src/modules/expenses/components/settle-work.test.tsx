// The settle page run from the bank row (F131 §5.1, the fourth exit *This row refunds me*): `?row=<id>` preselects
// the refund row and locks the picker — the FIFO proposal runs for it at once —, *Change* clears the param (a link,
// the page reloads unlocked), a row that cannot be a refund row leaves the picker open and says why, and *Confirm*
// returns to the row on `/banking`. The arithmetic itself is `settlement-math`'s (its own tests).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/expenses/settle",
}));
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

import { type OpenRow, SettleWork } from "./settle-work";

const ROW = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PRIVATE_SE = "33333333-3333-4333-8333-333333333333";

const open: OpenRow[] = [
  {
    expenseId: "e1",
    key: "Ex7-Tr-01",
    date: "2026-03-10",
    description: "Hotel",
    amountBase: "6450.00",
    openBase: "6450.00",
    paidFromAccountId: PRIVATE_SE,
    currency: "SEK",
    amount: "6450.00",
    openAmount: "6450.00",
  },
  {
    expenseId: "e2",
    key: "Ex7-Tr-02",
    date: "2026-03-11",
    description: "Train",
    amountBase: "1620.00",
    openBase: "1620.00",
    paidFromAccountId: PRIVATE_SE,
    currency: "SEK",
    amount: "1620.00",
    openAmount: "1620.00",
  },
];
const transactions = [
  {
    id: ROW,
    bookingDate: "2026-03-31",
    amount: "-8070.00",
    currency: "SEK",
    description: "Utlägg mars",
    bankAccountId: "acc",
    accountLabel: "Plusgirokonto SEK",
    amountBase: "-8070.00",
  },
  {
    id: OTHER,
    bookingDate: "2026-02-28",
    amount: "-500.00",
    currency: "SEK",
    description: "Utlägg februari",
    bankAccountId: "acc",
    accountLabel: "Plusgirokonto SEK",
    amountBase: "-500.00",
  },
];
const sources = [
  { id: PRIVATE_SE, label: "Private SE", kind: "private" as const, currency: "SEK" },
  { id: "acc", label: "Plusgirokonto SEK", kind: "bank_account" as const, currency: "SEK" },
];
const base = { open, transactions, sources, ledgerOpen: "8070.00", ledgerCount: 2 };

const proposalFor = (id: string) => ({
  data: {
    data: {
      bankTransactionId: id,
      paidFromAccountId: PRIVATE_SE,
      lines: [
        { expenseId: "e1", allocatedBase: "6450.00" },
        { expenseId: "e2", allocatedBase: "1620.00" },
      ],
    },
  },
});

describe("SettleWork — run from the row (?row=)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
    nav.push.mockClear();
    nav.refresh.mockClear();
  });

  it("the row preselected and locked: no picker, its facts shown, the FIFO proposed for it; Change links to the page without the param", async () => {
    render(<SettleWork {...base} lockedTransactionId={ROW} />);
    await waitFor(() => expect(calls.propose).toHaveBeenCalledTimes(1));
    expect(calls.propose.mock.calls[0]?.[0]).toMatchObject({ bankTransactionId: ROW });
    expect(screen.queryByTestId("pick-transaction")).toBeNull();
    const locked = screen.getByTestId("locked-transaction");
    expect(locked).toHaveTextContent("2026-03-31");
    expect(locked).toHaveTextContent("Utlägg mars");
    expect(locked).toHaveTextContent("Plusgirokonto SEK");
    expect(screen.getByTestId("change-transaction")).toHaveAttribute("href", "/expenses/settle");
    expect(screen.getByTestId("settle-summary")).toBeVisible();
    expect(screen.queryByTestId("row-not-settleable")).toBeNull();
  });

  it("without the param the picker is open and nothing is proposed until a row is picked (as before)", () => {
    render(<SettleWork {...base} />);
    expect(screen.getByTestId("pick-transaction")).toBeInTheDocument();
    expect(screen.queryByTestId("locked-transaction")).toBeNull();
    expect(screen.queryByTestId("settle-summary")).toBeNull();
    expect(calls.propose).not.toHaveBeenCalled();
  });

  it("a row that cannot be a refund row (not among the settleable ones) leaves the picker open and says why", () => {
    render(<SettleWork {...base} lockedTransactionId="99999999-9999-4999-8999-999999999999" />);
    expect(screen.getByTestId("pick-transaction")).toBeInTheDocument();
    expect(screen.getByTestId("row-not-settleable")).toHaveTextContent("cannot be a refund row");
    expect(calls.propose).not.toHaveBeenCalled();
  });

  it("Confirm from the row goes back to that row on /banking; from the page, to the settlements as before", async () => {
    calls.propose = vi.fn(async ({ bankTransactionId }: { bankTransactionId: string }) =>
      proposalFor(bankTransactionId),
    );
    calls.confirm = vi.fn(async () => ({ data: { data: { number: "ST26-003" } } }));
    render(<SettleWork {...base} lockedTransactionId={ROW} />);
    await waitFor(() => expect(screen.getByTestId("settle-hint")).toHaveTextContent("Exact match"));
    fireEvent.click(screen.getByTestId("open-confirm"));
    fireEvent.click(await screen.findByTestId("confirm-settlement"));
    await waitFor(() => expect(calls.confirm).toHaveBeenCalledTimes(1));
    expect(calls.confirm.mock.calls[0]?.[0]).toMatchObject({
      bankTransactionId: ROW,
      lines: [
        { expenseId: "e1", allocatedBase: "6450.00" },
        { expenseId: "e2", allocatedBase: "1620.00" },
      ],
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/banking?open=${ROW}`));
  });
});
