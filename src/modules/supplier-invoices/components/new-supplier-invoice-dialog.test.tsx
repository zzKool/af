import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { DuplicateMatch } from "@/modules/expenses";

// what the duplicate check answers in the test at hand
const dup = vi.hoisted(() => ({ matches: [] as DuplicateMatch[] }));

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
  DuplicatePanel: ({ matches }: { matches: DuplicateMatch[] }) =>
    matches.length ? (
      <div data-testid="duplicate-panel">{matches.map((m) => m.kind).join(",")}</div>
    ) : null,
  hasHighMatch: (ms: DuplicateMatch[]) => ms.some((m) => m.confidence === "high"),
  useDuplicateCheck: () => dup.matches,
}));
vi.mock("@/modules/partners/ui", async (orig) => ({
  ...(await orig<typeof import("@/modules/partners/ui")>()),
  PartnerMatchCard: () => null,
}));

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

const match = (kind: DuplicateMatch["kind"], id: string): DuplicateMatch => ({
  kind,
  confidence: kind === "fuzzy" ? "medium" : "high",
  entityType: "supplier_invoice",
  entityId: id,
  entityKey: `SI7-ADM-${id}`,
  partnerName: "Skattepunkten",
  reason: {
    key: `documents.duplicate.reason.${kind}`,
    params: { n: "9160", partner: "Skattepunkten" },
  },
});

describe("NewSupplierInvoiceDialog — the duplicate check (D35)", () => {
  afterEach(() => {
    cleanup();
    dup.matches = [];
  });
  const groups = [{ id: "g1", number: 7, description: "Receipts", kind: "batch" as const }];

  it("an exact number match is a stop: a link to the invoice, no note, no Create anyway, Create disabled", () => {
    dup.matches = [match("exact", "si1"), match("fuzzy", "si2")];
    render(<NewSupplierInvoiceDialog {...base} groups={groups} />);
    expect(screen.getByTestId("exact-number-stop")).toHaveTextContent("Number 9160 is SI7-ADM-si1");
    expect(screen.getByTestId("exact-number-open")).toHaveAttribute(
      "href",
      "/supplier-invoices?open=si1",
    );
    expect(screen.queryByTestId("duplicate-panel")).toBeNull();
    expect(screen.queryByTestId("duplicate-ack-note")).toBeNull();
    expect(screen.queryByText("Create anyway")).toBeNull();
    expect(screen.getByTestId("create-supplier-invoice")).toBeDisabled();
  });

  it("a hash match keeps Create anyway with a note; no stop", () => {
    dup.matches = [match("hash", "si3")];
    render(<NewSupplierInvoiceDialog {...base} groups={groups} />);
    expect(screen.queryByTestId("exact-number-stop")).toBeNull();
    expect(screen.getByTestId("duplicate-panel")).toHaveTextContent("hash");
    expect(screen.getByTestId("create-supplier-invoice")).toHaveTextContent("Create anyway");
  });

  it("a fuzzy match only warns: Create, no stop", () => {
    dup.matches = [match("fuzzy", "si4")];
    render(<NewSupplierInvoiceDialog {...base} groups={groups} />);
    expect(screen.queryByTestId("exact-number-stop")).toBeNull();
    expect(screen.getByTestId("duplicate-panel")).toHaveTextContent("fuzzy");
    expect(screen.getByTestId("create-supplier-invoice")).toHaveTextContent(
      "Create supplier invoice",
    );
  });
});

describe("NewSupplierInvoiceDialog — the BAS picker's suggestions (F125)", () => {
  afterEach(cleanup);

  it("the supplier's history on top of the picker, with how often it was used", async () => {
    render(
      <NewSupplierInvoiceDialog
        {...base}
        groups={[{ id: "g1", number: 7, description: "Receipts", kind: "batch" }]}
        categories={[
          { code: "6530", label: "6530 · Accounting services (Acc)" },
          { code: "6540", label: "6540 · IT services (IT)" },
        ]}
        basHistory={{ p1: [{ code: "6540", count: 2 }] }}
      />,
    );
    fireEvent.click(screen.getByTestId("si-category"));
    expect(await screen.findByText("Suggested")).toBeInTheDocument();
    const suggested = screen.getByTestId("bas-option-6540");
    expect(suggested).toHaveTextContent("used 2× before for this partner");
    // nothing is chosen for the owner: the field stays empty until a click (F124 (5))
    expect(screen.getByTestId("si-category")).not.toHaveTextContent("6540");
  });
});
