// The new rate's *valid from* defaults to today in Stockholm (lessons round 3 #10): at 00:30 in Stockholm the
// browser's UTC day is still yesterday — the kernel clock's day is the one the services use.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ executeAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/contracts/contracts.actions", () => ({
  createContractRateAction: "create",
  deleteContractRateAction: "delete",
  getContractRatesAction: "list",
  updateContractRateAction: "update",
}));

import { ContractRates } from "./contract-rates";

describe("ContractRates — the new rate's valid from", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is today in Stockholm, not the UTC day, just after midnight", () => {
    // 2026-03-31 22:30 UTC = 2026-04-01 00:30 in Stockholm (CEST)
    vi.setSystemTime(new Date("2026-03-31T22:30:00Z"));
    render(
      <LocaleProvider initialLocale="en">
        <ContractRates contractId="c1" currency="CHF" rates={[]} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add rate" }));
    expect(screen.getByLabelText("Valid from")).toHaveValue("2026-04-01");
  });
});
