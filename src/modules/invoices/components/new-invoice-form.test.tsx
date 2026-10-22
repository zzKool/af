import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// F76 — client A → contract → client B → submit must never send A's contract with B.
// The two actions are fakes with the service's data and rule (a contract belongs to one partner; createDraft
// refuses another partner's contract, like `invoices.createDraft`). The hook runs the action it is given, so
// the test sees exactly what the form would send — B's list is held back to open the race window.

type Contract = { id: string; name: string; currency: string; partnerId: string };
const CONTRACTS: Contract[] = [
  { id: "ca", name: "Consulting", currency: "CHF", partnerId: "pa" },
  { id: "cb", name: "Consulting", currency: "EUR", partnerId: "pb" },
];

const held = new Map<string, () => void>();
const created: { partnerId: string; contractId: string | null }[] = [];
const refused: string[] = [];

const fakes = vi.hoisted(() => ({
  getContracts: async (_: { partnerId: string }): Promise<unknown> => undefined,
  createDraft: async (_: { partnerId: string; contractId: string | null }): Promise<unknown> =>
    undefined,
}));

vi.mock("@/modules/contracts/ui", () => ({
  getContractsAction: (input: { partnerId: string }) => fakes.getContracts(input),
}));
vi.mock("@/modules/invoices/invoices.actions", () => ({
  createDraftAction: (input: { partnerId: string; contractId: string | null }) =>
    fakes.createDraft(input),
}));
// next-safe-action's hook, reduced to "run the action" with a stable executeAsync per action
vi.mock("next-safe-action/hooks", () => {
  const stable = new Map<unknown, (i: unknown) => Promise<unknown>>();
  return {
    useAction: (action: (i: unknown) => Promise<unknown>) => {
      if (!stable.has(action)) stable.set(action, (i: unknown) => action(i));
      return { executeAsync: stable.get(action), isPending: false };
    },
  };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { NewInvoiceForm } from "./new-invoice-form";

const clients = [
  { id: "pa", name: "Alpha SA", shortCode: "AL" },
  { id: "pb", name: "Beta AB", shortCode: "BE" },
];

beforeEach(() => {
  held.clear();
  created.length = 0;
  refused.length = 0;
  push.mockReset();
  fakes.getContracts = ({ partnerId }) => {
    const data = CONTRACTS.filter((c) => c.partnerId === partnerId);
    const answer = { data: { data } };
    if (partnerId !== "pb") return Promise.resolve(answer);
    return new Promise((resolve) => held.set(partnerId, () => resolve(answer)));
  };
  fakes.createDraft = async (input) => {
    const contract = CONTRACTS.find((c) => c.id === input.contractId);
    if (contract && contract.partnerId !== input.partnerId) {
      refused.push(input.contractId as string);
      return { data: { error: { message: "The contract belongs to another partner" } } };
    }
    created.push({ partnerId: input.partnerId, contractId: input.contractId });
    return { data: { data: { id: "inv-1" } } };
  };
});
afterEach(cleanup);

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("NewInvoiceForm — the contract always belongs to the chosen client (F76)", () => {
  it("client A → contract → client B → submit: A's contract never goes out with B", async () => {
    const user = userEvent.setup();
    render(<NewInvoiceForm clients={clients} initialType="invoice" today="2026-10-23" />);

    // client A: its contract is loaded and picked
    await waitFor(() =>
      expect(screen.getByLabelText("Contract")).toHaveTextContent("Consulting (CHF)"),
    );

    // client B: its list is still on the way
    await pick(user, "Client", "[BE] Beta AB");
    expect(screen.getByLabelText("Contract")).not.toHaveTextContent("Consulting");

    // submit inside the window — the old form sent { partner B, contract A } here
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(refused).toEqual([]);
    expect(created.every((c) => c.contractId !== "ca")).toBe(true);

    // B's list arrives: B's contract is picked and the draft goes out with it
    await act(async () => held.get("pb")?.());
    await waitFor(() =>
      expect(screen.getByLabelText("Contract")).toHaveTextContent("Consulting (EUR)"),
    );
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/invoices/inv-1"));
    expect(refused).toEqual([]);
    expect(created).toEqual([{ partnerId: "pb", contractId: "cb" }]);
  });
});
