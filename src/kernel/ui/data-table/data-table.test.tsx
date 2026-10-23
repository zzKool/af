import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { translator } from "@/kernel/i18n/translate";
import type { ListQuery } from "@/kernel/list-query/types";
import { DockedCanvas } from "@/kernel/ui/shell/details-dock";
import { DataTable } from "./data-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { describeFilter } from "./filter-bar";
import { compress, monthName, presetRange } from "./filters/date-filter";
import { SAVE_DEBOUNCE_MS, TablePreferencesProvider } from "./preferences";
import type { DataTableColumn } from "./types";
import type { ListQueryState } from "./use-list-query";

type Row = { id: string; name: string; currency: string | null; amount: string; created: string };

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", type: "text" },
  { key: "currency", header: "Currency", type: "enum" },
  { key: "amount", header: "Amount", type: "money" },
  { key: "created", header: "Created", type: "date" },
];

const rows: Row[] = [
  { id: "1", name: "Valtech", currency: "CHF", amount: "1200.00", created: "2026-10-20T00:00:00Z" },
  { id: "2", name: "Xylo", currency: null, amount: "-5.50", created: "2026-09-01T00:00:00Z" },
];

function makeState(
  query: Partial<ListQuery> = {},
): ListQueryState & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const rec =
    (k: string) =>
    (...args: unknown[]) => {
      calls[k] = args;
    };
  return {
    query: { page: 1, pageSize: 25, sort: [], filters: {}, ...query },
    isPending: false,
    setFilter: rec("setFilter"),
    clearFilters: rec("clearFilters"),
    setSort: rec("setSort"),
    setPage: rec("setPage"),
    setPageSize: rec("setPageSize"),
    setSearch: rec("setSearch"),
    calls,
  };
}

afterEach(cleanup);

describe("DataTable", () => {
  it("renders rows with typed default cells (money with currency, date as yyyy-mm-dd, blanks)", () => {
    render(
      <DataTable
        tableKey="t"
        columns={columns}
        result={{ rows, total: 2 }}
        state={makeState()}
        sumCurrency="CHF"
      />,
    );
    expect(screen.getByText("Valtech")).toBeTruthy();
    // the one on-screen money format (D40): U+202F thousands, "." decimals, U+2212 minus, code after
    const exact = { normalizer: (t: string) => t };
    expect(screen.getByText("1\u202F200.00\u00A0CHF", exact)).toBeTruthy();
    expect(screen.getByText("\u22125.50\u00A0CHF", exact)).toBeTruthy();
    expect(screen.getByText("2026-10-20")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("1–2 of 2")).toBeTruthy();
  });

  it("header click cycles sort asc → desc → none; shift-click adds a secondary sort", () => {
    const state = makeState({ sort: [{ col: "name", dir: "asc" }] });
    render(<DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={state} />);
    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(state.calls.setSort).toEqual([[{ col: "name", dir: "desc" }]]);
    fireEvent.click(screen.getByRole("button", { name: /^Currency/ }), { shiftKey: true });
    expect(state.calls.setSort).toEqual([
      [
        { col: "name", dir: "asc" },
        { col: "currency", dir: "asc" },
      ],
    ]);
  });

  it("shows a filter button per active filter (D40) that opens the column's popover; Clear filters clears", async () => {
    const state = makeState({
      filters: {
        currency: { kind: "in", values: ["CHF", null] },
        name: { kind: "text", op: "contains", value: "val" },
      },
    });
    render(<DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={state} />);
    expect(screen.getByRole("button", { name: 'Name: contains "val"' })).toBeTruthy();
    const currency = screen.getByRole("button", { name: "Currency: CHF, (Blanks)" });
    expect(currency.getAttribute("data-active")).toBe("true");
    // no removable chips any more
    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
    // the button opens the same text popover as the header
    fireEvent.click(screen.getByRole("button", { name: 'Name: contains "val"' }));
    expect(await screen.findByPlaceholderText("Text…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(state.calls.clearFilters).toEqual([]);
  });

  it("a quick-filter column shows its button while inactive; no filter, no Clear filters", () => {
    const quick = columns.map((c) => (c.key === "created" ? { ...c, quickFilter: true } : c));
    render(
      <DataTable tableKey="t" columns={quick} result={{ rows, total: 2 }} state={makeState()} />,
    );
    const created = document.querySelector("[data-filter-button=created]") as HTMLElement;
    expect(created.textContent).toBe("Created");
    expect(created.getAttribute("data-active")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("row actions: a ⋮ menu per row in the last column, the click does not open the row", async () => {
    const onRowClick = vi.fn();
    const remove = vi.fn();
    render(
      <DataTable
        tableKey="t"
        columns={columns}
        result={{ rows, total: 2 }}
        state={makeState()}
        onRowClick={onRowClick}
        rowActions={(row) => [{ label: `Delete ${row.name}`, onClick: remove, destructive: true }]}
      />,
    );
    const menus = screen.getAllByRole("button", { name: "Row actions" });
    expect(menus).toHaveLength(2);
    fireEvent.click(menus[0]);
    fireEvent.click(await screen.findByText("Delete Valtech"));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("rowHref: a row click navigates in the app; a link inside the row navigates alone (no second, full reload)", () => {
    push.mockClear();
    const linked: DataTableColumn<(typeof rows)[number]>[] = columns.map((c, i) =>
      i === 0 ? { ...c, cell: (row) => <a href={`/x/${row.id}`}>{`key ${row.id}`}</a> } : c,
    );
    render(
      <DataTable
        tableKey="t"
        columns={linked}
        result={{ rows, total: 2 }}
        state={makeState()}
        rowHref={(row) => `/x/${row.id}`}
      />,
    );
    const link = screen.getByText(`key ${rows[0].id}`);
    link.addEventListener("click", (e) => e.preventDefault()); // jsdom: no real navigation
    fireEvent.click(link);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(link.closest("tr")?.querySelectorAll("td")[1] as HTMLElement);
    expect(push).toHaveBeenCalledWith(`/x/${rows[0].id}`);
  });

  it("the enum header filter loads distinct values from the source and applies an `in` filter", async () => {
    const state = makeState();
    const distinct = vi.fn(async () => [
      { value: "CHF", count: 3 },
      { value: "SEK", count: 1 },
      { value: null, count: 2 },
    ]);
    render(
      <DataTable
        tableKey="t"
        columns={columns}
        result={{ rows, total: 2 }}
        state={state}
        filterSource={{ distinct, dateHierarchy: async () => ({ years: [], empty: 0 }) }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter Currency" }));
    await waitFor(() => expect(screen.getByText("SEK")).toBeTruthy());
    expect(distinct).toHaveBeenCalledWith("currency", state.query);
    expect(screen.getByText("(Blanks)")).toBeTruthy();
    // Excel-style: everything ticked; untick SEK → the others stay
    fireEvent.click(screen.getByText("SEK"));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(state.calls.setFilter).toEqual(["currency", { kind: "in", values: ["CHF", null] }]);
  });

  it("the text header filter applies the chosen operator", async () => {
    const state = makeState();
    render(<DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={state} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter Name" }));
    const input = await screen.findByPlaceholderText("Text…");
    fireEvent.change(input, { target: { value: "  val " } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(state.calls.setFilter).toEqual(["name", { kind: "text", op: "contains", value: "val" }]);
  });

  it("the money header filter validates numbers and applies a range", async () => {
    const state = makeState();
    render(<DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={state} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter Amount" }));
    fireEvent.change(await screen.findByPlaceholderText("Min"), { target: { value: "-10,5" } });
    fireEvent.change(screen.getByPlaceholderText("Max"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(state.calls.setFilter).toEqual(["amount", { kind: "range", min: "-10.5", max: "99" }]);
  });

  it("pagination and page size talk to the state", () => {
    const state = makeState({ page: 2, pageSize: 25 });
    render(<DataTable tableKey="t" columns={columns} result={{ rows, total: 60 }} state={state} />);
    expect(screen.getByText("26–50 of 60")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(state.calls.setPage).toEqual([3]);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(state.calls.setPage).toEqual([1]);
  });
});

describe("DataTable layout — hidden, order, widths per user (ui-conventions v2)", () => {
  const headerKeys = () =>
    Array.from(document.querySelectorAll("thead th[data-column]")).map((th) =>
      th.getAttribute("data-column"),
    );

  beforeEach(() => {
    localStorage.clear();
  });

  it("starts from the server's layout: order and hidden columns apply before any click", () => {
    render(
      <TablePreferencesProvider
        initial={{ t: { hidden: ["currency"], order: ["created", "name"], widths: { name: 200 } } }}
        save={async () => undefined}
      >
        <DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={makeState()} />
      </TablePreferencesProvider>,
    );
    expect(headerKeys()).toEqual(["created", "name", "amount"]);
    const name = document.querySelector("thead th[data-column=name]") as HTMLElement;
    expect(name.style.width).toBe("200px");
  });

  it("the Columns menu moves a column with the arrows and the change is saved, debounced", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    render(
      <TablePreferencesProvider initial={{}} save={save}>
        <DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={makeState()} />
      </TablePreferencesProvider>,
    );
    expect(headerKeys()).toEqual(["name", "currency", "amount", "created"]);
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Amount up" }));
    expect(headerKeys()).toEqual(["name", "amount", "currency", "created"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Amount up" }));
    expect(headerKeys()).toEqual(["amount", "name", "currency", "created"]);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      tableKey: "t",
      preferences: { hidden: [], order: ["amount", "name", "currency", "created"], widths: {} },
    });
    // the browser keeps a copy too
    expect(JSON.parse(localStorage.getItem("af.table.t.layout") ?? "{}").order).toEqual([
      "amount",
      "name",
      "currency",
      "created",
    ]);
    vi.useRealTimers();
  });

  it("drag a header onto another to reorder; the resize handle's arrow keys set a width; Reset clears", () => {
    render(
      <DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={makeState()} />,
    );
    const th = (key: string) =>
      document.querySelector(`thead th[data-column=${key}]`) as HTMLElement;
    const transfer = { effectAllowed: "", setData: vi.fn(), getData: () => "created" };
    fireEvent.dragStart(th("created"), { dataTransfer: transfer });
    fireEvent.dragOver(th("name"), { dataTransfer: transfer });
    fireEvent.drop(th("name"), { dataTransfer: transfer });
    expect(headerKeys()).toEqual(["created", "name", "currency", "amount"]);

    const handle = screen.getByRole("separator", { name: "Resize Name" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    // jsdom has no layout: the header measures 0, so the width lands on the minimum
    expect(th("name").style.width).toBe("48px");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(th("name").style.width).toBe("48px");

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByTestId("columns-reset"));
    expect(headerKeys()).toEqual(["name", "currency", "amount", "created"]);
    expect(th("name").style.width).toBe("");
  });

  it("without a provider the browser's copy is read back, including the visibility-only format", () => {
    localStorage.setItem("af.table.t.hidden", JSON.stringify(["amount"]));
    render(
      <DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={makeState()} />,
    );
    expect(headerKeys()).toEqual(["name", "currency", "created"]);
  });
});

describe("date filter helpers", () => {
  const hierarchy = {
    empty: 0,
    years: [
      {
        year: 2026,
        count: 3,
        months: [
          {
            month: "2026-10",
            count: 2,
            days: [
              { day: "2026-10-20", count: 1 },
              { day: "2026-10-21", count: 1 },
            ],
          },
          { month: "2026-09", count: 1, days: [{ day: "2026-09-01", count: 1 }] },
        ],
      },
      {
        year: 2025,
        count: 1,
        months: [{ month: "2025-12", count: 1, days: [{ day: "2025-12-31", count: 1 }] }],
      },
    ],
  };

  it("compresses a leaf selection to whole years, then months, then days", () => {
    const all2026 = new Set(["2026-10-20", "2026-10-21", "2026-09-01"]);
    expect(compress(all2026, hierarchy)).toEqual({ years: [2026] });
    expect(compress(new Set(["2026-10-20", "2026-10-21"]), hierarchy)).toEqual({
      months: ["2026-10"],
    });
    expect(compress(new Set(["2026-10-20", "2025-12-31"]), hierarchy)).toEqual({
      years: [2025],
      days: ["2026-10-20"],
    });
  });

  it("presets are whole calendar ranges in UTC", () => {
    const today = new Date("2026-10-20T12:00:00Z");
    expect(presetRange("thisMonth", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("lastMonth", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("thisQuarter", today)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(presetRange("thisYear", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(presetRange("lastYear", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("describes filters for chips", () => {
    expect(describeFilter({ kind: "dates", years: [2026], from: "2026-01-01" })).toBe(
      "2026 · from 2026-01-01",
    );
    expect(describeFilter({ kind: "range", min: "5", max: "5" })).toBe("= 5");
    expect(describeFilter({ kind: "text", op: "empty" })).toBe("is empty");
    expect(describeFilter({ kind: "in", values: ["a", "b", "c", "d"] })).toBe("a, b, c +1");
  });
});

describe("F74 — the filter popovers speak the UI language", () => {
  const sv = (ui: React.ReactNode) => <LocaleProvider initialLocale="sv-SE">{ui}</LocaleProvider>;
  const source = {
    distinct: async () => [
      { value: "CHF", count: 3 },
      { value: null, count: 2 },
    ],
    dateHierarchy: async () => ({
      years: [
        {
          year: 2026,
          count: 2,
          months: [{ month: "2026-07", count: 2, days: [{ day: "2026-07-03", count: 2 }] }],
        },
      ],
      empty: 1,
    }),
  };

  /** a fresh page per popover — one open popover at a time, as a user has it */
  async function openIn(column: string) {
    cleanup();
    localStorage.clear(); // another test's stored layout may hide a column
    const state = makeState({ filters: { name: { kind: "text", op: "empty" } } });
    render(
      sv(
        <DataTable
          tableKey="sv"
          columns={columns}
          result={{ rows, total: 2 }}
          state={state}
          filterSource={source}
        />,
      ),
    );
    fireEvent.click(screen.getAllByRole("button", { name: `Filtrera ${column}` })[0]);
    await screen.findByRole("button", { name: "OK" });
  }
  const noEnglish = () => {
    for (const word of [
      "OK ",
      "Clear",
      "Cancel",
      "This month",
      "(Blanks)",
      "Is empty",
      "Search values…",
    ])
      expect(screen.queryByText(word)).toBeNull();
  };

  it("text: Swedish buttons, the operator's label (never its value), the filter button's words", async () => {
    await openIn("Name");
    expect(document.querySelector("[data-filter-button=name]")?.textContent).toContain("är tom");
    expect(screen.getByText("Är tom")).toBeTruthy();
    expect(screen.queryByText("empty")).toBeNull();
    expect(screen.getByRole("button", { name: "Rensa" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Avbryt" })).toBeTruthy();
    noEnglish();
  });

  it("range: the presets and the word between the bounds", async () => {
    await openIn("Amount");
    expect(screen.getByRole("button", { name: "Tom" })).toBeTruthy();
    expect(screen.getByText("till")).toBeTruthy();
    noEnglish();
  });

  it("values: search, select all, blanks", async () => {
    await openIn("Currency");
    expect(await screen.findByText("(Tomma)")).toBeTruthy();
    expect(screen.getByPlaceholderText("Sök värden…")).toBeTruthy();
    expect(screen.getByText("Markera alla")).toBeTruthy();
    noEnglish();
  });

  it("dates: presets, the month's name, blanks", async () => {
    await openIn("Created");
    expect(screen.getByRole("button", { name: "Denna månad" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Förra året" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "(Tomma)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expandera" }));
    expect(monthName("2026-07", "sv")).toMatch(/^juli/);
    expect(screen.getByText(monthName("2026-07", "sv"))).toBeTruthy();
    noEnglish();
  });

  it("describeFilter takes the translator; English when none is given", () => {
    expect(describeFilter({ kind: "dates", to: "2026-01-31" })).toBe("to 2026-01-31");
    expect(describeFilter({ kind: "in", values: [null, "CHF"] })).toBe("(Blanks), CHF");
    const sv = translator("sv");
    expect(describeFilter({ kind: "in", values: [null, "CHF"] }, undefined, sv)).toBe(
      "(Tomma), CHF",
    );
    expect(describeFilter({ kind: "dates", from: "2026-01-01" }, undefined, sv)).toBe(
      "från 2026-01-01",
    );
  });
});

describe("F74 — the docked panel remembers open / hidden per table", () => {
  beforeEach(() => localStorage.clear());

  function Page({
    initial,
    save,
  }: {
    initial: Record<string, unknown>;
    save: () => Promise<undefined>;
  }) {
    return (
      <TablePreferencesProvider initial={initial} save={save}>
        <DockedCanvas>
          <main>
            <DataTable
              tableKey="tx"
              columns={columns}
              result={{ rows, total: 2 }}
              state={makeState()}
            />
          </main>
          <Sheet open onOpenChange={() => {}}>
            <SheetContent data-testid="panel">
              <SheetTitle>Row</SheetTitle>
            </SheetContent>
          </Sheet>
        </DockedCanvas>
      </TablePreferencesProvider>
    );
  }

  it("Hide collapses the panel to a rail, the choice is saved with the table, and a reload keeps it", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    render(<Page initial={{}} save={save} />);
    expect(screen.getByTestId("panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide the panel" }));
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(document.querySelector("[data-slot=details-rail]")).not.toBeNull();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10);
    expect(save).toHaveBeenCalledWith({
      tableKey: "tx",
      preferences: { hidden: [], order: [], widths: {}, panelHidden: true },
    });
    vi.useRealTimers();
    const stored = (save.mock.calls[0] as unknown as [{ preferences: Record<string, unknown> }])[0]
      .preferences;

    // the reload: the server hands back what was saved
    cleanup();
    render(<Page initial={{ tx: stored }} save={save} />);
    expect(screen.queryByTestId("panel")).toBeNull();
    const show = screen.getByRole("button", { name: "Show the panel" });
    fireEvent.click(show);
    expect(screen.getByTestId("panel")).toBeTruthy();
    expect(
      JSON.parse(localStorage.getItem("af.table.tx.layout") ?? "{}").panelHidden,
    ).toBeUndefined();
  });

  it("another table's choice does not leak; hiding the panel is not a column change (no Reset layout)", () => {
    render(
      <Page
        initial={{ other: { hidden: [], order: [], widths: {}, panelHidden: true } }}
        save={async () => undefined}
      />,
    );
    expect(screen.getByTestId("panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide the panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    expect(screen.queryByTestId("columns-reset")).toBeNull(); // the panel is not a column matter
  });
});
