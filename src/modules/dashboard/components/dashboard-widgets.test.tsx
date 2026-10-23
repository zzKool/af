// The dashboard's widgets in the reader's language: dates through the kernel's formatter (T005), the briefing's
// words from the dictionary (T004).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { BriefingWidget, BusinessPulseWidget } from "./dashboard-widgets";

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

describe("BusinessPulseWidget", () => {
  it("a balance is as of its ISO booking day in every language (D40: dates yyyy-mm-dd)", () => {
    render(
      <LocaleProvider initialLocale="sv-SE">
        <BusinessPulseWidget
          metrics={[
            {
              id: "balance:a",
              kind: "balance",
              label: "Plusgirokonto SEK",
              value: "1000.00",
              currency: "SEK",
              hint: "2026-07-14",
              href: "/banking",
            },
          ]}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/2026-07-14/)).toBeTruthy();
  });
});
