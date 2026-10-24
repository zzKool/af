import { describe, expect, test } from "vitest";
import { NAV_GROUPS, NAV_ITEMS, type NavItem, NEW_ITEMS } from "@/kernel/nav/constants";
import { filterNavItems } from "@/kernel/nav/nav-filter";

describe("filterNavItems", () => {
  test("owner sees the monthly loop's order (D40): Banking before Documents, Settings last", () => {
    const result = filterNavItems(NAV_ITEMS, "owner");
    const labels = result.map((i) => i.label);
    expect(labels).toEqual([
      "Dashboard",
      "Banking",
      "Documents",
      "Journal",
      "Partners",
      "Invoices",
      "Supplier invoices",
      "Expenses",
      "Package",
      "Declarations",
      "Settings",
    ]);
  });

  test("accountant sees Dashboard, Journal, Banking, Invoices (read-only) and Settings (Partners is owner-only)", () => {
    const result = filterNavItems(NAV_ITEMS, "accountant");
    const labels = result.map((i) => i.label);
    expect(labels).toEqual([
      "Dashboard",
      "Banking",
      "Journal",
      "Invoices",
      "Supplier invoices",
      "Expenses",
      "Package",
      "Declarations",
      "Settings",
    ]);
  });

  test("disabled items are excluded even if role matches", () => {
    const result = filterNavItems(NAV_ITEMS, "owner");
    const labels = result.map((i) => i.label);
    expect(labels).not.toContain("Reconciliation");
  });

  test("Documents is visible to owner but not accountant", () => {
    const ownerResult = filterNavItems(NAV_ITEMS, "owner");
    expect(ownerResult.map((i) => i.label)).toContain("Documents");

    const accountantResult = filterNavItems(NAV_ITEMS, "accountant");
    expect(accountantResult.map((i) => i.label)).not.toContain("Documents");
  });

  test("owner-only enabled items are not visible to accountant", () => {
    const withReconciliation: NavItem[] = NAV_ITEMS.map((item) =>
      item.path === "/reconciliation" ? { ...item, enabled: true } : item,
    );
    const accountantResult = filterNavItems(withReconciliation, "accountant");
    expect(accountantResult.map((i) => i.label)).not.toContain("Reconciliation");
  });

  test("empty items array returns empty", () => {
    expect(filterNavItems([], "owner")).toEqual([]);
  });
});

describe("NAV_ITEMS configuration", () => {
  test("all items have required fields", () => {
    for (const item of NAV_ITEMS) {
      expect(item.path).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.roles.length).toBeGreaterThan(0);
      expect(typeof item.enabled).toBe("boolean");
    }
  });

  test("every item but Reconciliation is enabled", () => {
    const disabled = NAV_ITEMS.filter((i) => !i.enabled).map((i) => i.label);
    expect(disabled).toEqual(["Reconciliation"]);
  });

  test("groups come in NAV_GROUPS order, each in one block; Dashboard first, Settings pinned last", () => {
    const groups = NAV_ITEMS.filter((i) => i.group).map((i) => i.group);
    const blocks = groups.filter((g, i) => g !== groups[i - 1]);
    expect(blocks).toEqual([...NAV_GROUPS]);
    expect(NAV_ITEMS[0].path).toBe("/dashboard");
    expect(NAV_ITEMS.filter((i) => i.bottom).map((i) => i.path)).toEqual(["/settings"]);
    expect(NAV_ITEMS.at(-1)?.path).toBe("/settings");
  });

  test("every + New entry opens an enabled page", () => {
    const enabled = NAV_ITEMS.filter((i) => i.enabled).map((i) => i.path);
    for (const n of NEW_ITEMS) {
      const path = n.href.split("?")[0];
      expect(enabled.some((p) => path === p || path.startsWith(`${p}/`))).toBe(true);
    }
  });

  test("F73: + New opens the dialog — ?new=1 on every list page, the invoice is its own page", () => {
    expect(NEW_ITEMS.map((n) => n.href)).toEqual([
      "/documents?new=1",
      "/banking?new=1",
      "/invoices/new",
      "/supplier-invoices?new=1",
      "/expenses?new=1",
    ]);
  });

  test("all paths start with /", () => {
    for (const item of NAV_ITEMS) {
      expect(item.path).toMatch(/^\//);
    }
  });
});
