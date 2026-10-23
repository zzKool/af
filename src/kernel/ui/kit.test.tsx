import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

describe("Select — shows the item's label, never a raw value (F74)", () => {
  const ID = "7f3c2a10-4b1e-4d2a-9c0e-1a2b3c4d5e6f";
  const trigger = (testId: string) =>
    screen.getByTestId(testId).querySelector("[data-slot=select-value]")?.textContent ?? "";

  function Partners() {
    return <SelectItem value={ID}>Valtech Switzerland SA</SelectItem>;
  }

  it("an id value shows its label; the none sentinel shows its label", () => {
    render(
      <>
        <Select value={ID}>
          <SelectTrigger data-testid="direct">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No partner</SelectItem>
            <SelectItem value={ID}>Valtech Switzerland SA</SelectItem>
          </SelectContent>
        </Select>
        <Select value="__none__">
          <SelectTrigger data-testid="none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No partner</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );
    expect(trigger("direct")).toBe("Valtech Switzerland SA");
    expect(trigger("none")).toBe("No partner");
  });

  it("items rendered by a child component: the label from `items`; without it, blank — never the id", () => {
    render(
      <>
        <Select value={ID} items={[{ value: ID, label: "Valtech Switzerland SA" }]}>
          <SelectTrigger data-testid="given">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <Partners />
          </SelectContent>
        </Select>
        <Select value={ID}>
          <SelectTrigger data-testid="unknown">
            <SelectValue placeholder="Pick a partner" />
          </SelectTrigger>
          <SelectContent>
            <Partners />
          </SelectContent>
        </Select>
        <Select value="__none__">
          <SelectTrigger data-testid="loading">
            <SelectValue />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </>,
    );
    expect(trigger("given")).toBe("Valtech Switzerland SA");
    expect(trigger("unknown")).toBe("Pick a partner");
    expect(trigger("loading")).toBe("");
    expect(document.body.textContent).not.toContain(ID);
    expect(document.body.textContent).not.toContain("__none__");
  });
});
