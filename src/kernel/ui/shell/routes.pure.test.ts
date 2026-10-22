import { describe, expect, test } from "vitest";
import { crumbsFor, destinationsFor, matches, navItemFor, SUB_PAGES } from "./routes";

describe("crumbsFor — names, never ids; the current page not repeated (D40)", () => {
  test("a top page has no trail", () => {
    expect(crumbsFor("/banking")).toEqual([]);
    expect(crumbsFor("/dashboard")).toEqual([]);
  });

  test("an entity page shows its list, never its id", () => {
    expect(crumbsFor("/partners/353ec92f-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toEqual([
      { href: "/partners", key: "nav.partners" },
    ]);
    expect(crumbsFor("/invoices/new")).toEqual([{ href: "/invoices", key: "nav.invoices" }]);
  });

  test("named sub-pages chain; unnamed segments (a route group, an id) are skipped", () => {
    expect(crumbsFor("/expenses/settlements/0b9c")).toEqual([
      { href: "/expenses", key: "nav.expenses" },
      { href: "/expenses/settlements", key: "expenses.nav.settlements" },
    ]);
    expect(crumbsFor("/settings/company")).toEqual([{ href: "/settings", key: "nav.settings" }]);
    expect(crumbsFor("/links/document/abc")).toEqual([]);
  });

  test("a disabled nav item is not a crumb", () => {
    expect(crumbsFor("/reconciliation/x")).toEqual([]);
  });
});

describe("destinationsFor — what the search finds, by role", () => {
  test("the owner gets every enabled page and the named sub-pages under them", () => {
    const d = destinationsFor("owner");
    expect(d.map((x) => x.href)).toContain("/documents");
    expect(d.map((x) => x.href)).toContain("/documents/inbox");
    expect(d.map((x) => x.href)).not.toContain("/reconciliation");
    expect(d.filter((x) => x.parent)).toHaveLength(Object.keys(SUB_PAGES).length);
  });

  test("the accountant does not find owner-only pages nor their sub-pages", () => {
    const hrefs = destinationsFor("accountant").map((x) => x.href);
    expect(hrefs).not.toContain("/documents");
    expect(hrefs).not.toContain("/documents/inbox");
    expect(hrefs).toContain("/banking/rules");
  });
});

describe("matches / navItemFor", () => {
  test("every word, any order, case and accents folded", () => {
    expect(matches("param soci", "Paramètres", "Société")).toBe(true);
    expect(matches("FACT four", "Factures fournisseurs")).toBe(true);
    expect(matches("bank xyz", "Banking")).toBe(false);
    expect(matches("", "anything")).toBe(true);
  });

  test("a path belongs to the nav item that prefixes it, not a look-alike", () => {
    expect(navItemFor("/expenses/groups/1")?.path).toBe("/expenses");
    expect(navItemFor("/invoices")?.path).toBe("/invoices");
    expect(navItemFor("/invoicesx")).toBeUndefined();
  });
});
