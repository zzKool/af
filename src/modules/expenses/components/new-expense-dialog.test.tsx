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

import { defaultSourceId, NewExpenseDialog } from "./new-expense-dialog";

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

  it("US1-1/3/4: no category until chosen (F124 (5)); the default fills it and replaces a previous default, marked from partner; none leaves it", () => {
    render(<NewExpenseDialog {...props} />);
    expect(category()).toHaveTextContent("—");
    expect(screen.queryByTestId("category-from-partner")).toBeNull();
    pick("cerf");
    expect(category()).toHaveTextContent(/583\s*Representation/);
    expect(screen.getByTestId("category-from-partner")).toBeInTheDocument();
    pick("sas");
    expect(category()).toHaveTextContent(/580\s*Travel/);
    pick("taxi"); // no default
    expect(category()).toHaveTextContent(/580\s*Travel/);
    pick(""); // cleared: the proposal stays
    expect(category()).toHaveTextContent(/580\s*Travel/);
  });

  it("F124 (5): the payer a document proposes is the company account in its currency, never the first of the list", () => {
    const sources = [
      ...props.sources,
      {
        id: "00000000-0000-4000-8000-000000000011",
        label: "Plusgirokonto CHF",
        kind: "bank_account" as const,
        bankAccountId: "00000000-0000-4000-8000-000000000011",
        currency: "CHF",
        isActive: true,
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        label: "Plusgirokonto SEK",
        kind: "bank_account" as const,
        bankAccountId: "00000000-0000-4000-8000-000000000012",
        currency: "SEK",
        isActive: true,
      },
    ];
    expect(defaultSourceId(sources, "sek")).toBe("00000000-0000-4000-8000-000000000012");
    expect(defaultSourceId(sources, "CHF")).toBe("00000000-0000-4000-8000-000000000011");
    // no company account in that currency: the first company account; no company account at all: the first source
    expect(defaultSourceId(sources, "EUR")).toBe("00000000-0000-4000-8000-000000000011");
    expect(defaultSourceId(sources)).toBe("00000000-0000-4000-8000-000000000011");
    expect(defaultSourceId(props.sources, "SEK")).toBe("00000000-0000-4000-8000-000000000002");
    render(
      <NewExpenseDialog
        {...props}
        sources={sources}
        initial={{ currency: "SEK", amount: "123.88", description: "Northwind" }}
      />,
    );
    expect(screen.getByLabelText("Paid by")).toHaveTextContent("Plusgirokonto SEK");
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
    expect(category()).toHaveTextContent(/583\s*Representation/);
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

describe("NewExpenseDialog — the AI's account for the receipt (F126)", () => {
  afterEach(cleanup);
  const ai = { code: "690", reason: "Small office supplies", prefill: true };

  it("HIGH fills the empty field, marked as the AI's; a partner's default replaces it", () => {
    render(<NewExpenseDialog {...props} initial={{ currency: "CHF", basProposal: ai }} />);
    expect(category()).toHaveTextContent(/690\s*Other/);
    expect(screen.getByTestId("expense-category")).toHaveAttribute("data-prefilled", "true");
    expect(screen.getByTestId("category-from-ai")).toBeInTheDocument();
    pick("cerf");
    expect(category()).toHaveTextContent(/583\s*Representation/);
    expect(screen.queryByTestId("category-from-ai")).toBeNull();
  });

  it("MEDIUM (no prefill) leaves the field empty — the account waits on top of the picker", () => {
    render(
      <NewExpenseDialog
        {...props}
        initial={{ currency: "CHF", basProposal: { ...ai, prefill: false } }}
      />,
    );
    expect(category()).toHaveTextContent("—");
    expect(screen.queryByTestId("category-from-ai")).toBeNull();
  });
});
