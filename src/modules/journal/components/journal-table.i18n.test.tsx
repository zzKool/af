// T009 (FR-006): every header and filter label of the ledger comes from the dictionary — a French or Swedish user
// sees no English column name, no `(code)` / `(id)` suffix and no `(Blanks)`. The DataTable is stubbed to read the
// columns and the value labeller the ledger hands it.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { translate } from "@/kernel/i18n/translate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
  linkEntryAction: "link",
}));
vi.mock("@/modules/linking/linking.actions", () => ({
  getLinksWithLabelsAction: "links",
  removeLinkAction: "remove",
  searchLinkablesAction: "search",
}));

type Seen = {
  columns: { key: string; header: string }[];
  valueLabel: (column: string, value: string | null) => string;
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

function ledger(locale: string) {
  seen.length = 0;
  render(
    <LocaleProvider initialLocale={locale}>
      <JournalTable
        result={{ rows: [], total: 0, page: 1, pageSize: 25, sums: {} } as never}
        categories={[]}
        partners={[]}
        today="2026-10-23"
        canWrite={false}
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
  ] as const)("%s: the four last headers and the blank label come from the dictionary", (locale, lang) => {
    const { columns, valueLabel } = ledger(locale);
    const header = Object.fromEntries(columns.map((c) => [c.key, c.header]));
    expect(header).toMatchObject({
      createdAt: translate(lang, "journal.col.created"),
      updatedAt: translate(lang, "journal.col.updated"),
      basCode: translate(lang, "journal.col.categoryCode"),
      partnerId: translate(lang, "journal.col.partnerId"),
    });
    expect(valueLabel("basCode", null)).toBe(translate(lang, "common.blanks"));
  });

  it("a French user sees none of the old English", () => {
    const { columns, valueLabel } = ledger("fr-CH");
    const headers = columns.map((c) => c.header);
    for (const english of ["Created", "Updated", "Category (code)", "Partner (id)"])
      expect(headers).not.toContain(english);
    expect(valueLabel("partnerId", null)).toBe("(Vides)");
  });
});
