// F187: the confirm dialog says what *Use my usual accounts* does before anything is written — the set, the counts,
// the *Deactivate the others* box (on by default) and the accounts that stay and why; Apply sends the box's value
// and hands the new list to the page.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { readPlan, apply, planAction, applyAction } = vi.hoisted(() => ({
  readPlan: vi.fn(async (_: unknown) => ({
    data: {
      data: {
        activate: ["1630", "2650"],
        notes: ["1630", "2650", "6540"],
        deactivate: ["1930", "2440", "6900"],
        kept: [
          { code: "5830", label: "5830 · Board and lodging", reasons: ["shortCode"], uses: 0 },
          { code: "6910", label: "6910 · Licence fees", reasons: ["inUse"], uses: 3 },
        ],
      },
    },
  })),
  apply: vi.fn(async (_: unknown) => ({
    data: { data: { activated: 2, notes: 3, deactivated: 0, kept: 2, preferences: [] } },
  })),
  planAction: { name: "getMyAccountsPlan" },
  applyAction: { name: "applyMyAccounts" },
}));
vi.mock("@/modules/settings/bas-preferences.actions", () => ({
  getMyAccountsPlanAction: planAction,
  applyMyAccountsAction: applyAction,
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (a: unknown) => ({
    executeAsync: a === planAction ? readPlan : apply,
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MyAccountsDialog } from "./my-accounts-dialog";

afterEach(cleanup);

const CATS = [
  { code: "1630", name: "Avräkning för skatter och avgifter", nameEn: "Tax account" },
  { code: "6540", name: "IT-tjänster", nameEn: "IT services" },
];

describe("MyAccountsDialog (F187)", () => {
  it("reads the plan on open and says what happens: the set, the counts, the kept accounts and why", async () => {
    render(<MyAccountsDialog categories={CATS} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByTestId("bas-use-mine"));
    await waitFor(() => expect(screen.getByTestId("bas-mine-set")).toBeInTheDocument());
    expect(readPlan).toHaveBeenCalledWith({});
    const set = screen.getByTestId("bas-mine-set");
    expect(set).toHaveTextContent("1630");
    expect(set).toHaveTextContent("Tax account");
    expect(set).toHaveTextContent("Skatteverket");
    expect(set).toHaveTextContent("7220");
    expect(screen.getByTestId("bas-mine-summary")).toHaveTextContent("Activates 2 accounts");
    expect(screen.getByTestId("bas-mine-summary")).toHaveTextContent(
      "Writes the note on 3 accounts",
    );
    expect(screen.getByText("Deactivate the others (3)")).toBeInTheDocument();
    expect(screen.getByTestId("bas-mine-deactivate")).toHaveAttribute("aria-checked", "true");
    const kept = screen.getByTestId("bas-mine-kept");
    expect(kept).toHaveTextContent("2 other accounts stay active");
    expect(kept).toHaveTextContent("5830 · Board and lodging");
    expect(kept).toHaveTextContent("short code");
    expect(kept).toHaveTextContent("used by 3 records");
  });

  it("Apply sends the box's value and hands the new list to the page", async () => {
    const onApplied = vi.fn();
    render(<MyAccountsDialog categories={CATS} onApplied={onApplied} />);
    fireEvent.click(screen.getByTestId("bas-use-mine"));
    await waitFor(() => expect(screen.getByTestId("bas-mine-set")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("bas-mine-deactivate"));
    expect(screen.getByTestId("bas-mine-deactivate")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByTestId("bas-mine-apply"));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith([]));
    expect(apply).toHaveBeenCalledWith({ deactivateOthers: false });
  });
});
