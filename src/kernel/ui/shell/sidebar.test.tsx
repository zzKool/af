import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const shell = vi.hoisted(() => ({ collapsed: false }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
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

  it("collapsed: a dot, the count in the tooltip", () => {
    shell.collapsed = true;
    render(<Sidebar role={OWNER} counts={{ "/banking": 3 }} />);
    const banking = screen.getByRole("link", { name: "Banking" });
    expect(banking).toHaveAttribute("title", "Banking (3)");
    expect(banking.textContent).toBe("Banking"); // the label, visually hidden — no number in the link
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute("title", "Journal");
  });

  it("no counts given (the accountant) — nothing extra", () => {
    render(<Sidebar role={ACCOUNTANT} />);
    expect(screen.getByRole("link", { name: "Banking" }).textContent).toBe("Banking");
  });
});
