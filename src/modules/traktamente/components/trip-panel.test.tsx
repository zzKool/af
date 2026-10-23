// The trip panel: the per-diem expense's category is shown read-only once the expense exists (T002 — the replace
// keeps it), and the server's reason / warnings / computation error print in the user's language (T003).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";

const executeAsync = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ executeAsync, isPending: false }),
}));
vi.mock("@/modules/traktamente/traktamente.actions", () => ({
  countryOptionsAction: "countries",
  createPerDiemExpenseAction: "write",
  upsertTripAction: "save",
}));

import { toast } from "sonner";
import type { PerDiemResult } from "@/modules/traktamente/types";
import { TripPanel, type TripView } from "./trip-panel";

const GROUP = "11111111-1111-4111-8111-111111111111";

const computed: PerDiemResult = {
  fullDays: 2,
  halfDays: 2,
  nights: 3,
  days: 3,
  reason: null,
  countryCode: "CH",
  rateYears: [2025, 2026],
  mealRateYear: 2025,
  perDay: [],
  dayTotal: "4200.00",
  meals: { breakfasts: 0, lunches: 0, dinners: 0, deduction: "0.00" },
  nightAllowance: { nights: 0, nightAmount: "0.00", total: "0.00" },
  longStayFactor: null,
  total: "4200.00",
  warnings: [
    {
      type: "two_rate_years",
      message: "trip spans two rate years (2025, 2026)",
      years: "2025, 2026",
    },
  ],
  computedAt: "2026-10-23T10:00:00.000Z",
};

const trip: TripView = {
  id: "t1",
  tenantId: "tenant",
  groupId: GROUP,
  departureAt: "2025-12-30T08:00",
  returnAt: "2026-01-02T17:00",
  countryCode: "CH",
  agency: null,
  breakfasts: 0,
  lunches: 0,
  dinners: 0,
  nightsWithoutPaidLodging: 0,
  longStayFactor: null,
  computed,
  perDiemExpenseId: "e1",
  perDiemDocumentId: null,
};

const categories = [
  { code: "580", label: "580 Resekostnader (Tr)" },
  { code: "590", label: "590 Övrigt (Ov)" },
];

function panel(props: Partial<Parameters<typeof TripPanel>[0]> = {}, locale = "sv-SE") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <TripPanel
        groupId={GROUP}
        trip={trip}
        countries={[{ countryCode: "CH", name: "Switzerland", dayAmount: "1402", year: 2026 }]}
        categories={categories}
        perDiemExpense={{ id: "e1", key: "Ex213-Ov-01", amount: "4200.00", basCode: "590" }}
        canWrite
        locale={null}
        {...props}
      />
    </LocaleProvider>,
  );
}

describe("TripPanel", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    executeAsync.mockResolvedValue(undefined);
  });

  it("T002: once the per-diem expense exists its category is shown, not offered — and the recompute keeps it", async () => {
    panel();
    expect(screen.getByTestId("per-diem-category")).toHaveTextContent("590 Övrigt (Ov)");
    expect(screen.queryByRole("combobox", { name: /kategori|category/i })).toBeNull();
    await act(async () => fireEvent.click(screen.getByTestId("write-per-diem")));
    expect(executeAsync).toHaveBeenCalledWith({ groupId: GROUP, basCode: "590" });
  });

  it("T002: before the expense exists the category is a choice, the travel category preselected", () => {
    panel({ perDiemExpense: null });
    expect(screen.queryByTestId("per-diem-category")).toBeNull();
    expect(
      screen.getByLabelText("Kategori för traktamentsutlägget", { exact: false }),
    ).toBeTruthy();
  });

  it("F71: on-screen money through formatMoney, the expense key a code chip, warnings with the attention icon", () => {
    panel({}, "en");
    expect(screen.getByTestId("trip-total").textContent).toBe("4\u202f200.00\u00a0SEK");
    expect(screen.getByTestId("per-diem-expense").querySelector("code")).toHaveTextContent(
      "Ex213-Ov-01",
    );
    expect(
      screen.getByTestId("trip-result").querySelector('[data-state-family="attention"], svg'),
    ).not.toBeNull();
  });

  it("T003: the warnings print in the user's language", () => {
    panel();
    expect(screen.getByTestId("trip-result")).toHaveTextContent(
      "resan sträcker sig över två beloppsår (2025, 2026)",
    );
    expect(screen.queryByText(/trip spans two rate years/)).toBeNull();
  });

  it("T003: an older snapshot's unknown line prints as written", () => {
    panel({
      trip: { ...trip, computed: { ...computed, warnings: [{ type: "other", message: "kept" }] } },
    });
    expect(screen.getByTestId("trip-result")).toHaveTextContent("kept");
  });

  it("T003: no overnight stay is a translated reason", () => {
    panel({
      trip: { ...trip, computed: { ...computed, reason: "no overnight stay", warnings: [] } },
      perDiemExpense: null,
    });
    expect(screen.getByTestId("trip-result")).toHaveTextContent(
      "Inget är skattefritt: ingen övernattning",
    );
  });

  it("T003: the computation error of a save and of a write names the rule in the user's language", async () => {
    executeAsync.mockResolvedValueOnce(undefined); // the country list on mount
    panel({}, "fr-CH");
    executeAsync.mockResolvedValueOnce({
      data: {
        data: {
          trip: { ...trip, computed: null },
          computeError: {
            code: "BUSINESS_RULE_VIOLATION",
            message: "No travel allowance rate for CH in 2025",
            retryable: false,
            details: { rule: "missing_rate", countryCode: "CH", year: 2025 },
          },
        },
      },
    });
    await act(async () => fireEvent.click(screen.getByTestId("save-trip")));
    expect(screen.getByTestId("trip-error")).toHaveTextContent(
      "Aucun barème d'indemnité de voyage pour CH en 2025",
    );

    cleanup();
    panel({}, "sv-SE");
    executeAsync.mockResolvedValueOnce({
      data: {
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: "Lunches (40) exceed the 20 days of the trip",
          retryable: false,
          details: { rule: "too_many_meals", meal: "lunches", count: 40, days: 20 },
        },
      },
    });
    await act(async () => fireEvent.click(screen.getByTestId("write-per-diem")));
    expect(toast.error).toHaveBeenCalledWith("Luncher (40) överstiger resans 20 dagar");
  });
});
