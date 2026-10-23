// The dashboard's widgets: dates through the kernel's formatter (T005), the briefing's words from the dictionary
// (T004), the D40 kit (F71) — money through `formatMoney`, the priority as a state icon, no palette colours.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDateTime } from "@/kernel/i18n/format-date";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { ActionItemsWidget, BriefingWidget, BusinessPulseWidget } from "./dashboard-widgets";

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

describe("ActionItemsWidget (F71)", () => {
  it("money through formatMoney, the priority as a state family, the count as a grey badge", () => {
    const { container } = render(
      <LocaleProvider initialLocale="fr-CH">
        <ActionItemsWidget
          items={[
            {
              id: "supplier-overdue",
              kind: "supplier_invoices_overdue",
              count: 3,
              amount: { value: "-12345.6", currency: "SEK" },
              priority: "high",
              href: "/supplier-invoices?f.status=in:overdue",
            },
            {
              id: "receipts",
              kind: "receipts_missing",
              count: 1,
              priority: "low",
              href: "/expenses?f.hasDocument=in:false",
            },
          ]}
        />
      </LocaleProvider>,
    );
    const [overdue, receipts] = screen.getAllByTestId("action-item");
    // U+2212 minus, U+202F thousands, the code after a no-break space — compared exactly (lessons: jest-dom
    // normalises those spaces away)
    expect(overdue?.textContent).toContain("· \u221212\u202f345.60\u00a0SEK");
    expect(overdue?.querySelector("svg.text-state-attention")).not.toBeNull();
    expect(receipts?.querySelector("svg.text-state-neutral")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/(bg|text)-(red|amber|green|yellow)-\d/);
  });
});

describe("BusinessPulseWidget (F71)", () => {
  it("figures through formatMoney", () => {
    render(
      <LocaleProvider initialLocale="sv-SE">
        <BusinessPulseWidget
          metrics={[
            {
              id: "receivables:CHF",
              kind: "receivables",
              label: "receivables",
              value: "10810.00",
              currency: "CHF",
              hint: "1",
              href: "/invoices",
            },
          ]}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link").textContent).toBe("10\u202f810.00\u00a0CHF");
  });
});
