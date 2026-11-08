import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const shell = vi.hoisted(() => ({ collapsed: false, toggle: () => {} }));
let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/kernel/ui/shell/shell-context", () => ({ useShell: () => shell }));

import { Sidebar } from "./sidebar";

// a variable, not a literal: `role={OWNER}` reads as an ARIA role to the linter
const OWNER = "owner" as const;
const ACCOUNTANT = "accountant" as const;

describe("Sidebar — counts of open work (F72)", () => {
  afterEach(() => {
    cleanup();
    shell.collapsed = false;
  });

  it("a badge beside the label when the count is > 0; none at 0 or absent; the link keeps its name", () => {
    render(<Sidebar role={OWNER} counts={{ "/banking": 3, "/documents": 0 }} />);
    const banking = screen.getByRole("link", { name: "Banking" });
    expect(banking.textContent).toBe("Banking3");
    expect(screen.getByRole("link", { name: "Documents" }).textContent).toBe("Documents");
    expect(screen.getByRole("link", { name: "Invoices" }).textContent).toBe("Invoices");
  });

  it("collapsed (D76): the number on the icon's corner, aria-hidden — the name stays the label, the tooltip has both", () => {
    shell.collapsed = true;
    render(<Sidebar role={OWNER} counts={{ "/banking": 3 }} />);
    const banking = screen.getByRole("link", { name: "Banking" });
    expect(banking).toHaveAttribute("title", "Banking (3)");
    expect(banking.textContent).toBe("Banking3"); // the label (visually hidden) + the badge (aria-hidden)
    expect(screen.getByRole("link", { name: "Partners" })).toHaveAttribute("title", "Partners");
  });

  it("the rail's foot opens and closes it (D76): named by its visible text, aria-expanded follows", () => {
    render(<Sidebar role={OWNER} />);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    cleanup();
    shell.collapsed = true;
    render(<Sidebar role={OWNER} />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("no counts given (the accountant) — nothing extra", () => {
    render(<Sidebar role={ACCOUNTANT} />);
    expect(screen.getByRole("link", { name: "Banking" }).textContent).toBe("Banking");
  });

  it("Work (F97 US4, F137): first after Dashboard with the one count; on /work it is the active item, not Banking", () => {
    pathname = "/work";
    render(<Sidebar role={OWNER} counts={{ "/work": 5, "/banking": 3 }} />);
    const links = screen.getAllByRole("link").map((l) => l.textContent);
    expect(links.slice(0, 3)).toEqual(["Dashboard", "Work5", "Banking3"]);
    expect(screen.getByRole("link", { name: "Work" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Banking" })).not.toHaveAttribute("aria-current");
    pathname = "/dashboard";
  });
});
