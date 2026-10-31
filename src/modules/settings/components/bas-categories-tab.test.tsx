// F126 (US3): Settings → BAS shows the *Use for* notes — a draft is marked and confirmable, the bar counts them, and
// *Draft with AI* waits for a configured model.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { confirm, confirmAction } = vi.hoisted(() => ({
  confirm: vi.fn(async (_: unknown) => ({ data: { data: { confirmed: 1 } } })),
  confirmAction: { name: "confirmUseForNotes" },
}));
vi.mock("@/modules/settings/bas-preferences.actions", () => ({
  activateBasCategoriesAction: {},
  deactivateBasCategoryAction: {},
  updateBasPreferenceAction: {},
  draftUseForNotesAction: {},
  confirmUseForNotesAction: confirmAction,
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: (a: unknown) => ({
    executeAsync: a === confirmAction ? confirm : vi.fn(async () => ({ data: {} })),
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * 44 })),
    measureElement: () => {},
  }),
}));

import { BasCategoriesTab } from "./bas-categories-tab";

const cat = (code: string, name: string, nameEn: string) => ({
  code,
  name,
  nameEn,
  nameFr: null,
  className: "ÖVRIGA EXTERNA RÖRELSEUTGIFTER",
  classNum: 6,
  isCommon: false,
  suggestedAlias: null,
});
const CATS = [
  cat("654", "IT-tjänster", "IT services"),
  cat("657", "Bankkostnader", "Banking costs"),
];
const pref = (
  c: (typeof CATS)[number],
  useFor: string | null,
  useForState: "draft" | "confirmed" | null,
) => ({
  id: c.code,
  basCode: c.code,
  isFavorite: true,
  shortCode: null,
  translations: null,
  useFor,
  useForState,
  basCategory: c,
});

describe("BasCategoriesTab — Use for notes", () => {
  afterEach(cleanup);

  it("a draft is marked and confirmable; the bar counts; Draft with AI waits for a model", async () => {
    render(
      <BasCategoriesTab
        initialCategories={CATS}
        initialPreferences={[
          pref(CATS[0] as (typeof CATS)[number], "Software licences", "draft"),
          pref(CATS[1] as (typeof CATS)[number], "Bank fees", "confirmed"),
        ]}
      />,
    );
    fireEvent.click(screen.getByText(/^6\./));
    expect(screen.getByTestId("bas-notes-bar")).toHaveTextContent(
      "1 of 2 active accounts confirmed · 1 drafts",
    );
    expect(screen.getByTestId("bas-draft-ai")).toBeDisabled();
    expect(screen.getByTestId("bas-note-654")).toHaveAttribute("data-state", "draft");
    expect(screen.getByTestId("bas-note-654")).toHaveTextContent("DraftSoftware licences");
    expect(screen.queryByTestId("bas-note-confirm-657")).toBeNull();
    fireEvent.click(screen.getByTestId("bas-note-confirm-654"));
    await waitFor(() =>
      expect(screen.getByTestId("bas-note-654")).toHaveAttribute("data-state", "confirmed"),
    );
    expect(confirm).toHaveBeenCalledWith({ codes: ["654"] });
    expect(screen.queryByTestId("bas-confirm-all")).toBeNull();
  });

  it("with a model, Draft with AI is offered", () => {
    render(
      <BasCategoriesTab
        initialCategories={CATS}
        initialPreferences={[pref(CATS[0] as (typeof CATS)[number], null, null)]}
        aiOn
      />,
    );
    expect(screen.getByTestId("bas-draft-ai")).toBeEnabled();
  });
});
