// F170 (the board *Pulse — Expenses*): the new-expense form docks beside the list instead of covering it — the
// panel sits in the shell's dock (not an overlay), keeps the form (its fields, its proposals, its Create), closes on
// × / Cancel, and shares the dock with the row's details: one panel at a time (the dock store), `?new=1` opens it
// and closing it drops the param.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));
const calls = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: { data: { id: "e1", key: "Ex1-Tr-01" } } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: nav.replace }),
  usePathname: () => "/expenses",
  useSearchParams: () => nav.params,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => ({
    executeAsync: action === "create" ? calls.create : vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));
vi.mock("@/modules/expenses/expenses.actions", () => ({
  createExpenseAction: "create",
  checkExpenseDuplicatesAction: "dup",
  createExpenseGroupAction: "group",
  expenseVendorsAction: "vendors",
}));
vi.mock("./duplicate-panel", () => ({
  DuplicatePanel: () => null,
  hasHighMatch: () => false,
  useDuplicateCheck: () => [],
}));
vi.mock("./partner-picker", () => ({
  useVendors: () => ({
    vendors: [{ id: "sas", name: "SAS", defaultBasCategoryCode: "5800" }],
    add: vi.fn(),
  }),
  PartnerPicker: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <select data-testid="expense-partner" onChange={(e) => onChange(e.target.value || null)}>
      <option value="">none</option>
      <option value="sas">SAS</option>
    </select>
  ),
}));
vi.mock("@/modules/partners/ui", () => ({ PartnerMatchCard: () => null }));

import { DockedCanvas } from "@/kernel/ui/shell/details-dock";
import { announceDockedPanel } from "./dock-channel";
import { NewExpenseButton } from "./header-actions";
import { NewExpensePanel } from "./new-expense-dialog";

const thisMonth = new Date().toISOString().slice(0, 7);
const options = {
  groups: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      number: 3,
      description: `${thisMonth} receipts`,
      kind: "batch" as const,
    },
  ],
  categories: [{ code: "5800", label: "5800 · Travel (Tr)" }],
  sources: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      label: "Private CH",
      kind: "private" as const,
      bankAccountId: null,
      currency: "CHF",
      isActive: true,
    },
  ],
  documents: [],
};

/** the canvas the app shell renders: the list on the left, the dock on the right */
function Canvas({ children }: { children: React.ReactNode }) {
  return (
    <DockedCanvas>
      <div data-testid="the-list">the list</div>
      {children}
    </DockedCanvas>
  );
}

const dock = () => document.querySelector("[data-slot=details-dock]") as HTMLElement;

describe("NewExpensePanel — docked beside the list (F170)", () => {
  afterEach(() => {
    cleanup();
    calls.create.mockClear();
  });

  it("renders in the dock, not an overlay: no backdrop, the list stays; the form's fields and Create are there", () => {
    render(
      <Canvas>
        <NewExpensePanel open onOpenChange={() => {}} {...options} />
      </Canvas>,
    );
    const panel = screen.getByTestId("new-expense-dialog");
    expect(dock()).toContainElement(panel);
    expect(panel).toHaveAttribute("data-docked");
    expect(document.querySelector("[data-slot=sheet-overlay]")).toBeNull();
    expect(screen.getByTestId("the-list")).toBeVisible();
    expect(screen.getByRole("heading", { name: "New expense" })).toBeInTheDocument();
    for (const id of [
      "expense-description",
      "expense-amount",
      "expense-category",
      "create-expense",
    ])
      expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it("keeps the form's behaviour: the month's group proposed, Create waits for a category, then sends the form", async () => {
    const onOpenChange = vi.fn();
    render(
      <Canvas>
        <NewExpensePanel open onOpenChange={onOpenChange} {...options} />
      </Canvas>,
    );
    fireEvent.change(screen.getByTestId("expense-description"), { target: { value: "Taxi" } });
    fireEvent.change(screen.getByTestId("expense-amount"), { target: { value: "20.00" } });
    expect(screen.getByTestId("create-expense")).toBeDisabled();
    fireEvent.change(screen.getByTestId("expense-partner"), { target: { value: "sas" } });
    expect(screen.getByTestId("category-from-partner")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-expense"));
    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create.mock.calls[0]?.[0]).toMatchObject({
      groupId: "00000000-0000-4000-8000-000000000003",
      description: "Taxi",
      amount: "20.00",
      basCode: "5800",
      partnerId: "sas",
      paidFromAccountId: "00000000-0000-4000-8000-000000000002",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Cancel and × close it", () => {
    const onOpenChange = vi.fn();
    render(
      <Canvas>
        <NewExpensePanel open onOpenChange={onOpenChange} {...options} />
      </Canvas>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });
});

describe("NewExpenseButton — one panel in the dock at a time (F170)", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams();
    nav.replace.mockClear();
  });
  afterEach(cleanup);

  it("the button opens the docked form and says so; a row picked closes it", async () => {
    const heard: string[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent<string>).detail);
    window.addEventListener("af:expenses-dock", listen);
    render(
      <Canvas>
        <NewExpenseButton options={options} />
      </Canvas>,
    );
    expect(screen.queryByTestId("new-expense-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("open-new-expense"));
    expect(dock()).toContainElement(screen.getByTestId("new-expense-dialog"));
    // the list hears it and closes its row
    expect(heard).toEqual(["new"]);
    // what the list does on a row click
    act(() => announceDockedPanel("row"));
    await waitFor(() => expect(screen.queryByTestId("new-expense-dialog")).toBeNull());
    window.removeEventListener("af:expenses-dock", listen);
  });

  it("its own announcement does not close it", () => {
    render(
      <Canvas>
        <NewExpenseButton options={options} />
      </Canvas>,
    );
    fireEvent.click(screen.getByTestId("open-new-expense"));
    act(() => announceDockedPanel("new"));
    expect(screen.getByTestId("new-expense-dialog")).toBeInTheDocument();
  });

  it("?new=1 opens it; closed by a row picked, the param is dropped", async () => {
    nav.params = new URLSearchParams("new=1&sort=date");
    render(
      <Canvas>
        <NewExpenseButton options={options} />
      </Canvas>,
    );
    expect(await screen.findByTestId("new-expense-dialog")).toBeInTheDocument();
    act(() => announceDockedPanel("row"));
    expect(nav.replace).toHaveBeenCalledWith("/expenses?sort=date", { scroll: false });
  });
});
