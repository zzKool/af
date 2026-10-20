import { describe, expect, test } from "vitest";
import { NAV_ITEMS, type NavItem } from "@/kernel/nav/constants";
import { filterNavItems } from "@/kernel/nav/nav-filter";

describe("filterNavItems", () => {
  test("owner sees Dashboard, Documents, Partners, Invoices, and Settings", () => {
    const result = filterNavItems(NAV_ITEMS, "owner");
    const labels = result.map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Documents", "Partners", "Invoices", "Settings"]);
  });

  test("accountant sees Dashboard, Invoices (read-only) and Settings (Partners is owner-only)", () => {
    const result = filterNavItems(NAV_ITEMS, "accountant");
    const labels = result.map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Invoices", "Settings"]);
  });

  test("disabled items are excluded even if role matches", () => {
    const result = filterNavItems(NAV_ITEMS, "owner");
    const labels = result.map((i) => i.label);
    expect(labels).not.toContain("Journal");
    expect(labels).not.toContain("Banking");
  });

  test("Documents is visible to owner but not accountant", () => {
    const ownerResult = filterNavItems(NAV_ITEMS, "owner");
    expect(ownerResult.map((i) => i.label)).toContain("Documents");

    const accountantResult = filterNavItems(NAV_ITEMS, "accountant");
    expect(accountantResult.map((i) => i.label)).not.toContain("Documents");
  });

  test("owner-only enabled items are not visible to accountant", () => {
    const withBanking: NavItem[] = NAV_ITEMS.map((item) =>
      item.path === "/banking" ? { ...item, enabled: true } : item,
    );
    const accountantResult = filterNavItems(withBanking, "accountant");
    expect(accountantResult.map((i) => i.label)).not.toContain("Banking");
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

  test("Dashboard, Documents, Partners, Invoices, and Settings are enabled", () => {
    const enabled = NAV_ITEMS.filter((i) => i.enabled).map((i) => i.label);
    expect(enabled).toEqual(["Dashboard", "Documents", "Partners", "Invoices", "Settings"]);
  });

  test("all paths start with /", () => {
    for (const item of NAV_ITEMS) {
      expect(item.path).toMatch(/^\//);
    }
  });
});
