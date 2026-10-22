import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { DockedCanvas } from "@/kernel/ui/shell/details-dock";
import { STATE_FAMILIES, StateLabel } from "@/kernel/ui/state-label";

afterEach(cleanup);

describe("StateLabel — icon + word, never colour alone (D40)", () => {
  it.each(STATE_FAMILIES)("%s: the word, an icon, the family on the element", (family) => {
    const { container } = render(<StateLabel family={family} state={`word-${family}`} />);
    const el = container.querySelector(`[data-state-family=${family}]`) as HTMLElement;
    expect(el.textContent).toBe(`word-${family}`);
    expect(el.querySelector("svg")).not.toBeNull();
    // no pill: no background class
    expect(el.className).not.toMatch(/\bbg-/);
  });
});

describe("Sheet — docked inside the shell, overlay outside", () => {
  function Panel() {
    return (
      <Sheet open onOpenChange={() => {}}>
        <SheetContent data-testid="panel">
          <SheetTitle>Row</SheetTitle>
        </SheetContent>
      </Sheet>
    );
  }

  it("inside DockedCanvas the panel renders in the dock, beside the page, with no backdrop", () => {
    render(
      <DockedCanvas>
        <main data-testid="page">table</main>
        <Panel />
      </DockedCanvas>,
    );
    const panel = screen.getByTestId("panel");
    const dock = document.querySelector("[data-slot=details-dock]") as HTMLElement;
    expect(dock.contains(panel)).toBe(true);
    expect(panel.hasAttribute("data-docked")).toBe(true);
    expect(document.querySelector("[data-slot=sheet-overlay]")).toBeNull();
  });

  it("outside the shell it is the overlay sheet it always was", () => {
    render(<Panel />);
    expect(screen.getByTestId("panel").hasAttribute("data-docked")).toBe(false);
    expect(document.querySelector("[data-slot=sheet-overlay]")).not.toBeNull();
  });
});

describe("DetailsSection", () => {
  it("collapses and expands from its header; History-style sections start collapsed", () => {
    render(
      <>
        <DetailsSection title="About">
          <DetailsGrid rows={[["Amount", "12.00 SEK"]]} />
        </DetailsSection>
        <DetailsSection title="History" defaultOpen={false}>
          <p>created</p>
        </DetailsSection>
      </>,
    );
    const about = screen.getByRole("button", { name: "About" });
    expect(about.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("12.00 SEK")).toBeTruthy();
    fireEvent.click(about);
    expect(about.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});
