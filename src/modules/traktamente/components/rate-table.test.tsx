// F71 (D40 kit) on the rate table: amounts through formatMoney (the header names SEK), the code and the source as
// grey tags, Edit / Delete behind the row's ⋮, the year tabs as underline tabs, one split primary.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";

const push = vi.fn();
const executeAsync = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ executeAsync, isPending: false }),
}));
vi.mock("@/modules/traktamente/traktamente.actions", () => ({
  copyRatesFromYearAction: "copy",
  deleteRateAction: "delete",
  pasteSkatteverketCsvAction: "paste",
  upsertRateAction: "upsert",
}));

import { RateActions, type RateRowView, RateTable, RateYearTabs } from "./rate-table";

const row: RateRowView = {
  id: "r1",
  tenantId: "t",
  year: 2026,
  countryCode: "CH",
  countryNameSv: "Schweiz",
  countryNameEn: "Switzerland",
  dayAmount: "1402.00",
  nightAmount: null,
  mealBreakfast: null,
  mealLunch: null,
  mealDinner: null,
  mealAll: null,
  rateSource: "v1-seed",
};
const se: RateRowView = {
  ...row,
  id: "r2",
  countryCode: "SE",
  countryNameSv: "Sverige",
  countryNameEn: null,
  dayAmount: "290.00",
  nightAmount: "145.00",
  mealBreakfast: "58.00",
  mealLunch: "102.00",
  mealDinner: "102.00",
  mealAll: "261.00",
};

const wrap = (ui: React.ReactNode) =>
  render(<LocaleProvider initialLocale="en">{ui}</LocaleProvider>);

describe("RateTable — the D40 kit (F71)", () => {
  afterEach(cleanup);
  beforeEach(() => vi.clearAllMocks());

  it("amounts through formatMoney, bare (the header names SEK); the code and the source are tags", () => {
    wrap(<RateTable rows={[row, se]} />);
    const [ch, sweden] = screen.getAllByTestId("rate-row");
    expect(ch.textContent).toContain("1\u202f402.00"); // U+202F, formatMoney's thousands
    expect(ch).toHaveTextContent("½");
    expect(ch).toHaveTextContent("15 / 35 / 35 %");
    expect(sweden).toHaveTextContent("58.00 / 102.00 / 102.00 · 261.00");
    expect(screen.getAllByText("v1-seed")[0]).toHaveClass("bg-tag");
    expect(screen.getByText("CH")).toHaveClass("bg-tag");
    expect(ch).not.toHaveTextContent("SEK");
  });

  it("Edit and Delete sit behind the row's ⋮", () => {
    wrap(<RateTable rows={[row]} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Row actions" })).toBeInTheDocument();
  });

  it("the year tabs are underline tabs; picking one opens that year", async () => {
    wrap(<RateYearTabs years={[2026, 2025]} year={2026} />);
    expect(screen.getByRole("tab", { name: "2026" })).toHaveAttribute("aria-selected", "true");
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: "2025" })));
    expect(push).toHaveBeenCalledWith("/settings/traktamente?year=2025");
  });

  it("one split primary: Add country, its variants behind ▾", () => {
    wrap(<RateActions years={[2026, 2025]} year={2026} />);
    expect(screen.getByRole("button", { name: "Add country" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More ways to add rates" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste Skatteverket CSV" })).toBeNull();
  });
});
