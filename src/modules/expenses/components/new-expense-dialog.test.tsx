// F87 (US1, US4; FR-003, FR-009): the partner in the new-expense dialog — the default category proposed, never
// overwriting the owner's choice; the match card from a document; nothing picked without a click; the partner sent.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const calls = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: { data: { id: "e1", key: "Ex1-Rep-01" } } }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
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
// the picker as a native select (the dialog's wiring is under test, not Base UI's listbox)
vi.mock("./partner-picker", () => ({
  useVendors: () => ({
    vendors: [
      { id: "cerf", name: "Restaurant Le Cerf", defaultBasCategoryCode: "583" },
      { id: "sas", name: "SAS", defaultBasCategoryCode: "580" },
      { id: "taxi", name: "Taxi Neuchâtel", defaultBasCategoryCode: null },
    ],
    add: vi.fn(),
  }),
  PartnerPicker: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (id: string | null) => void;
  }) => (
    <select
      data-testid="expense-partner"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">none</option>
      <option value="cerf">Restaurant Le Cerf</option>
      <option value="sas">SAS</option>
      <option value="taxi">Taxi Neuchâtel</option>
    </select>
  ),
}));
vi.mock("@/modules/partners/ui", () => ({
  PartnerMatchCard: ({ onUseMatch }: { onUseMatch: (id: string) => void }) => (
    <button type="button" data-testid="partner-match-use" onClick={() => onUseMatch("cerf")}>
      Use match
    </button>
  ),
}));

import { NewExpenseDialog } from "./new-expense-dialog";

const props = {
  open: true,
  onOpenChange: () => {},
  groups: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      number: 1,
      description: "March",
      kind: "batch" as const,
    },
  ],
  categories: [
    { code: "580", label: "580 · Travel (Tr)" },
    { code: "583", label: "583 · Representation (Rep)" },
    { code: "690", label: "690 · Other (Ov)" },
  ],
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

const category = () => screen.getByLabelText("Category");
const pick = (id: string) =>
  fireEvent.change(screen.getByTestId("expense-partner"), { target: { value: id } });

describe("NewExpenseDialog — the partner (F87)", () => {
  afterEach(() => {
    cleanup();
    calls.create.mockClear();
  });

  it("US1-1/3/4: the default replaces the pre-selection and a previous default, marked from partner; none leaves it", () => {
    render(<NewExpenseDialog {...props} />);
    expect(category()).toHaveTextContent("580 · Travel");
    expect(screen.queryByTestId("category-from-partner")).toBeNull();
    pick("cerf");
    expect(category()).toHaveTextContent("583 · Representation");
    expect(screen.getByTestId("category-from-partner")).toBeInTheDocument();
    pick("sas");
    expect(category()).toHaveTextContent("580 · Travel");
    pick("taxi"); // no default
    expect(category()).toHaveTextContent("580 · Travel");
    pick(""); // cleared: the proposal stays
    expect(category()).toHaveTextContent("580 · Travel");
  });

  it("US4: no card without OCR facts; with them, nothing is picked until Use match, which proposes the default", () => {
    const { unmount } = render(<NewExpenseDialog {...props} />);
    expect(screen.queryByTestId("partner-match-use")).toBeNull();
    unmount();
    render(
      <NewExpenseDialog
        {...props}
        initial={{
          description: "RESTAURANT LE CERF SA",
          vendor: { name: "RESTAURANT LE CERF SA" },
        }}
      />,
    );
    expect(screen.getByTestId("expense-partner")).toHaveValue("");
    fireEvent.click(screen.getByTestId("partner-match-use"));
    expect(screen.getByTestId("expense-partner")).toHaveValue("cerf");
    expect(category()).toHaveTextContent("583 · Representation");
    // the description stays the merchant's (US4-4)
    expect(screen.getByTestId("expense-description")).toHaveValue("RESTAURANT LE CERF SA");
  });

  it("sends the picked partner with the form, its proposed category with it", async () => {
    render(<NewExpenseDialog {...props} />);
    fireEvent.change(screen.getByTestId("expense-description"), { target: { value: "Dinner" } });
    fireEvent.change(screen.getByTestId("expense-amount"), { target: { value: "120.00" } });
    pick("cerf");
    fireEvent.click(screen.getByTestId("create-expense"));
    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create.mock.calls[0]?.[0]).toMatchObject({ partnerId: "cerf", basCode: "583" });
  });
});
