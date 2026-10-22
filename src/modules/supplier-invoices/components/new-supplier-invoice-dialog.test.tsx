import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ executeAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/modules/supplier-invoices/supplier-invoices.actions", () => ({
  checkSupplierInvoiceDuplicatesAction: vi.fn(),
  copyLastSupplierInvoiceAction: vi.fn(),
  createSupplierInvoiceAction: vi.fn(),
}));
vi.mock("@/modules/expenses/expenses.actions", () => ({ createExpenseGroupAction: vi.fn() }));
// the real GroupPicker (the test types a new group into it); the rest of the barrel stubbed
vi.mock("@/modules/expenses/ui", async () => ({
  ...(await vi.importActual<typeof import("@/modules/expenses/components/group-picker")>(
    "@/modules/expenses/components/group-picker",
  )),
  DuplicatePanel: () => null,
  hasHighMatch: () => false,
  useDuplicateCheck: () => [],
}));
vi.mock("./supplier-match-card", () => ({ SupplierMatchCard: () => null }));

import { NewSupplierInvoiceDialog } from "./new-supplier-invoice-dialog";

const base = {
  open: true,
  onOpenChange: () => {},
  categories: [{ code: "6530", label: "6530 Accounting" }],
  suppliers: [
    {
      id: "p1",
      name: "Skattepunkten",
      defaultCurrency: null,
      defaultBasCategoryCode: null,
      paymentTermsDays: 20,
    },
  ],
  registrations: [],
  documents: [],
};

describe("NewSupplierInvoiceDialog — what the owner picked survives a re-render", () => {
  afterEach(cleanup);

  it("a new group typed in stays when the page re-renders with new option arrays", () => {
    // no group yet → the dialog opens on "+ New group…"
    const { rerender } = render(<NewSupplierInvoiceDialog {...base} groups={[]} />);
    fireEvent.change(screen.getByTestId("new-group-description"), {
      target: { value: "Admin 2026" },
    });
    // the route refreshes while the dialog is open (a server action refreshed the session cookie): new arrays,
    // and meanwhile another group exists
    rerender(
      <NewSupplierInvoiceDialog
        {...base}
        suppliers={[...base.suppliers]}
        categories={[...base.categories]}
        groups={[{ id: "g1", number: 7, description: "Receipts", kind: "batch" }]}
      />,
    );
    expect(screen.getByTestId("new-group-description")).toHaveValue("Admin 2026");
  });
});
