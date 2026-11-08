// The briefing: dates through the kernel's formatter (T005), its words from the dictionary (T004). The moves and
// the figures are tested with the home (`home.test.tsx`, F138).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { BriefingWidget } from "./dashboard-widgets";

afterEach(cleanup);

const SINCE = "2026-07-14T08:30:00.000Z";

describe("BriefingWidget", () => {
  it("titles the briefing with the kernel's date-time in the UI language", () => {
    render(
      <LocaleProvider initialLocale="fr-CH">
        <BriefingWidget
          since={SINCE}
          lines={[{ entityType: "bank_transaction", action: "create", count: 2 }]}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(`Depuis le ${formatDateTime(SINCE, "fr")}`)).toBeTruthy();
    expect(screen.getByTestId("briefing-line").textContent).toBe(
      "2 transaction(s) bancaire(s) créé(s)",
    );
  });
});
