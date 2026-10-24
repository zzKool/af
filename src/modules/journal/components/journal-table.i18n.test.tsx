// T009 (FR-006): every header and filter label of the ledger comes from the dictionary — a French or Swedish user
// sees no English column name, no `(code)` / `(id)` suffix and no `(Blanks)`. The DataTable is stubbed to read the
// columns and the value labeller the ledger hands it.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { translate } from "@/kernel/i18n/translate";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ executeAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/journal/journal.actions", () => ({
  categoriseEntryAction: "categorise",
  createManualEntryAction: "create",
  deleteManualEntryAction: "delete",
  distinctJournalValuesAction: "distinct",
  journalDateHierarchyAction: "dates",
  journalEntryHistoryAction: "history",
  linkEntryAction: "link",
}));
vi.mock("@/modules/linking/linking.actions", () => ({
  getLinksWithLabelsAction: "links",
  removeLinkAction: "remove",
  searchLinkablesAction: "search",
}));

type Seen = {
  columns: { key: string; header: string; quickFilter?: boolean }[];
  valueLabel: (column: string, value: string | null) => string;
  rowActions?: (
    row: Record<string, unknown>,
  ) => { label: string; onClick: () => void; destructive?: boolean }[];
};
const seen: Seen[] = [];
vi.mock("@/kernel/ui/data-table", () => ({
  DataTable: (props: Seen) => {
    seen.push(props);
    return null;
  },
  useListQuery: () => ({ query: { filters: {}, search: undefined } }),
}));
vi.mock("@/components/ui/sheet", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Sheet: Pass,
    SheetContent: Pass,
    SheetHeader: Pass,
    SheetTitle: Pass,
    SheetDescription: Pass,
  };
});

import { JournalTable } from "./journal-table";

function ledger(locale: string, canWrite = false) {
  seen.length = 0;
  render(
    <LocaleProvider initialLocale={locale}>
      <JournalTable
        result={{ rows: [], total: 0, page: 1, pageSize: 25, sums: {} } as never}
        categories={[]}
        partners={[]}
        canWrite={canWrite}
      />
    </LocaleProvider>,
  );
  const last = seen.at(-1);
  if (!last) throw new Error("DataTable not rendered");
  return last;
}

describe("the ledger's strings (T009)", () => {
  afterEach(cleanup);

  it.each([
    ["en-GB", "en"],
    ["fr-CH", "fr"],
    ["sv-SE", "sv"],
  ] as const)(
    "%s: the four last headers and the blank label come from the dictionary",
    (locale, lang) => {
      const { columns, valueLabel } = ledger(locale);
      const header = Object.fromEntries(columns.map((c) => [c.key, c.header]));
      expect(header).toMatchObject({
        createdAt: translate(lang, "journal.col.created"),
        updatedAt: translate(lang, "journal.col.updated"),
        basCode: translate(lang, "journal.col.categoryCode"),
        partnerId: translate(lang, "journal.col.partnerId"),
      });
      expect(valueLabel("basCode", null)).toBe(translate(lang, "common.blanks"));
    },
  );

  it("a French user sees none of the old English", () => {
    const { columns, valueLabel } = ledger("fr-CH");
    const headers = columns.map((c) => c.header);
    for (const english of ["Created", "Updated", "Category (code)", "Partner (id)"])
      expect(headers).not.toContain(english);
    expect(valueLabel("partnerId", null)).toBe("(Vides)");
  });
});

// F71: the D40 kit on the ledger — the two common filters as buttons, the ⋮ actions a row's source allows.
describe("the ledger on the D40 kit (F71)", () => {
  afterEach(cleanup);

  it("Date (by month) and Account are the quick filters; a manual entry's blank account reads *Manual*", () => {
    const { columns, valueLabel } = ledger("en-GB");
    expect(columns.filter((c) => c.quickFilter).map((c) => c.key)).toEqual([
      "entryDate",
      "accountAlias",
    ]);
    expect(valueLabel("accountAlias", null)).toBe("Manual");
    expect(valueLabel("accountAlias", "Nordea CHF")).toBe("Nordea CHF");
    expect(valueLabel("amount", null)).toBe("(Blanks)");
  });

  it("⋮: a bank entry opens its bank row; a manual entry offers Delete to the owner only", () => {
    const owner = ledger("en-GB", true).rowActions;
    if (!owner) throw new Error("no rowActions");
    const bank = owner({ sourceType: "bank_transaction", sourceId: "tx-1" });
    expect(bank.map((a) => a.label)).toEqual(["Open the bank row"]);
    bank[0].onClick();
    expect(push).toHaveBeenCalledWith("/banking?open=tx-1");
    const manual = owner({ sourceType: "manual", sourceId: null });
    expect(manual).toEqual([expect.objectContaining({ label: "Delete entry", destructive: true })]);

    const accountant = ledger("en-GB", false).rowActions;
    if (!accountant) throw new Error("no rowActions");
    expect(accountant({ sourceType: "manual", sourceId: null })).toEqual([]);
    expect(accountant({ sourceType: "bank_transaction", sourceId: "tx-1" })).toHaveLength(1);
  });
});
