import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { RANK, type SearchGroup } from "@/kernel/search/types";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard" }));

import {
  isPaletteShortcut,
  SEARCH_DEBOUNCE_MS,
  SearchPalette,
  sectionsFor,
} from "./search-palette";

const OWNER = "owner" as const;

const invoices: SearchGroup = {
  kind: "invoice",
  hits: [
    {
      kind: "invoice",
      id: "i1",
      key: "VA23-INV-001",
      label: "Acme AB · April 2023",
      date: "2023-04-30",
      amount: "1250.00",
      currency: "CHF",
      href: "/invoices/i1",
      rank: RANK.exactKey,
    },
  ],
  more: false,
  seeAllHref: "/invoices?q=VA23-INV-001",
};
const bank: SearchGroup = {
  kind: "bank_transaction",
  hits: [
    {
      kind: "bank_transaction",
      id: "b1",
      key: null,
      label: "INVOICE VA23",
      date: "2023-05-10",
      amount: "1250.00",
      currency: "CHF",
      href: "/banking?open=b1",
      rank: RANK.text,
    },
  ],
  more: true,
  seeAllHref: "/banking?q=VA23-INV-001",
};

async function openAndType(text: string) {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const input = await screen.findByRole("combobox", { name: "Search" });
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10);
  });
  return input;
}

describe("SearchPalette (F93)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    router.push.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("Ctrl K, ⌘ K and Ctrl P open it; Alt or a plain K do not", () => {
    expect(isPaletteShortcut({ ctrlKey: true, metaKey: false, altKey: false, key: "k" })).toBe(
      true,
    );
    expect(isPaletteShortcut({ ctrlKey: false, metaKey: true, altKey: false, key: "K" })).toBe(
      true,
    );
    expect(isPaletteShortcut({ ctrlKey: true, metaKey: false, altKey: false, key: "p" })).toBe(
      true,
    );
    expect(isPaletteShortcut({ ctrlKey: true, metaKey: false, altKey: true, key: "k" })).toBe(
      false,
    );
    expect(isPaletteShortcut({ ctrlKey: false, metaKey: false, altKey: false, key: "k" })).toBe(
      false,
    );
  });

  it("an exact key's group comes before the pages; the others after", () => {
    const pages = [{ href: "/invoices", key: "nav.invoices" as const, icon: "invoices" }];
    expect(sectionsFor(pages, [invoices, bank]).map((s) => s.id)).toEqual([
      "invoice",
      "pages",
      "bank_transaction",
    ]);
    // `more` adds a See all item to the group
    expect(sectionsFor([], [bank])[0].items.map((i) => i.type)).toEqual(["hit", "more"]);
  });

  it("asks the server, shows the groups, ↓ ↑ Enter opens the deep link", async () => {
    const search = vi.fn(async () => ({ data: { data: [invoices, bank] } }));
    render(<SearchPalette role={OWNER} search={search} />);
    const input = await openAndType("VA23-INV-001");

    expect(search).toHaveBeenCalledWith({ q: "VA23-INV-001" });
    expect(await screen.findByRole("group", { name: "Invoices" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Bank rows" })).toBeInTheDocument();
    const first = screen.getByRole("option", { name: /VA23-INV-001/ });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", first.id);
    expect(first).toHaveTextContent("1 250.00 CHF");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(router.push).toHaveBeenCalledWith("/invoices/i1");
  });

  it("an older answer never overwrites a newer one", async () => {
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => {
      release = r;
    });
    const search = vi
      .fn()
      .mockImplementationOnce(async () => {
        await slow;
        return { data: { data: [bank] } };
      })
      .mockImplementationOnce(async () => ({ data: { data: [invoices] } }));
    render(<SearchPalette role={OWNER} search={search} />);
    const input = await openAndType("VA");
    fireEvent.change(input, { target: { value: "VA23-INV-001" } });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10);
    });
    await act(async () => {
      release(undefined);
    });
    expect(await screen.findByRole("group", { name: "Invoices" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Bank rows" })).toBeNull();
  });

  it("one character: pages only, no server call", async () => {
    const search = vi.fn();
    render(<SearchPalette role={OWNER} search={search} />);
    await openAndType("b");
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "Banking" })).toBeInTheDocument();
  });
});
