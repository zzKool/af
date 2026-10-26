// F94 US1-1 (D49's rule): the vendor proposes its category and currency, never over the owner's choice; a bill is paid
// from a company account; the group defaults to a new one named after the subscription (Q2 B). Invented values.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../subscriptions.actions", () => ({
  createSubscriptionAction: "create",
  makeRecurringAction: "recurring",
}));
const create = vi.fn(async () => ({ data: { data: { id: "s1" } } }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (a: string) => ({ executeAsync: a === "create" ? create : vi.fn(), isPending: false }),
}));

import type { SubscriptionPageOptions } from "../page-data";
import { SubscriptionFormDialog } from "./subscription-form-dialog";

const options: SubscriptionPageOptions = {
  vendors: [
    { id: "v1", name: "Byteform AB", defaultBasCategoryCode: "6540", defaultCurrency: "SEK" },
    { id: "v2", name: "Tabula GmbH", defaultBasCategoryCode: "6550", defaultCurrency: "EUR" },
  ],
  categories: [
    { code: "6540", label: "6540 · IT-tjänster (IT)" },
    { code: "6550", label: "6550 · Konsultarvoden (Kons)" },
    { code: "580", label: "580 · Resekostnader (Tr)" },
  ],
  groups: [{ id: "g1", label: "217 — Online subscription" }],
  sources: [
    { id: "s-sek", label: "AF SEK", kind: "bank_account", currency: "SEK" },
    { id: "s-priv", label: "Private SE", kind: "private", currency: "SEK" },
  ],
  registrations: [],
};

afterEach(cleanup);

let user: ReturnType<typeof userEvent.setup>;
async function pick(testId: string, option: string) {
  await user.click(screen.getByTestId(testId));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("SubscriptionFormDialog", () => {
  it("the vendor proposes its category, currency, name and match text; a later vendor replaces only proposals", async () => {
    user = userEvent.setup();
    render(<SubscriptionFormDialog open onOpenChange={() => {}} options={options} />);
    await pick("sub-vendor", "Byteform AB");
    expect(screen.getByTestId("sub-category")).toHaveTextContent("6540");
    expect(screen.getByTestId("sub-name")).toHaveValue("Byteform AB");
    expect(screen.getByTestId("sub-match")).toHaveValue("Byteform AB");
    expect(screen.getByTestId("sub-group")).toHaveTextContent("Byteform AB");
    // the owner chooses another category: a second vendor no longer moves it
    await pick("sub-category", "580 · Resekostnader (Tr)");
    await pick("sub-vendor", "Tabula GmbH");
    expect(screen.getByTestId("sub-category")).toHaveTextContent("580");
    expect(screen.getByTestId("sub-currency")).toHaveTextContent("EUR");
  });

  it("a supplier invoice offers company accounts only", async () => {
    user = userEvent.setup();
    render(<SubscriptionFormDialog open onOpenChange={() => {}} options={options} />);
    await pick("sub-becomes", "Supplier invoice");
    await user.click(screen.getByTestId("sub-payer"));
    const list = await screen.findByRole("listbox");
    expect(within(list).queryByText("Private SE")).toBeNull();
    expect(within(list).getByText("AF SEK")).toBeInTheDocument();
  });
});
