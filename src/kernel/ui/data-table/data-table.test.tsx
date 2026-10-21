import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListQuery } from "@/kernel/list-query/types";
import { DataTable } from "./data-table";
import { describeFilter } from "./filter-chips";
import { compress, presetRange } from "./filters/date-filter";
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
    expect(screen.getByText("1'200.00 CHF")).toBeTruthy();
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

  it("shows chips for active filters and removes one through its chip", () => {
    const state = makeState({
      filters: {
        currency: { kind: "in", values: ["CHF", null] },
        name: { kind: "text", op: "contains", value: "val" },
      },
    });
    render(<DataTable tableKey="t" columns={columns} result={{ rows, total: 2 }} state={state} />);
    expect(screen.getByText('contains "val"')).toBeTruthy();
    expect(screen.getByText("CHF, (Blanks)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter on Currency" }));
    expect(state.calls.setFilter).toEqual(["currency", null]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(state.calls.clearFilters).toEqual([]);
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
