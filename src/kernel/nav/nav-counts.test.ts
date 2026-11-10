import { describe, expect, test } from "vitest";
import { NAV_ITEMS } from "@/kernel/nav/constants";
import { navCounts, type OpenWork } from "@/kernel/nav/nav-counts";
import { filterNavItems } from "@/kernel/nav/nav-filter";

const open = (o: Partial<OpenWork> = {}): OpenWork => ({
  rowsToJustify: 0,
  documentsToReview: 0,
  overdueInvoices: 0,
  overdueSupplierInvoices: 0,
  rateGapDays: 0,
  ...o,
});

describe("navCounts — the rail's numbers (F72, F97 US4, F182)", () => {
  test("Work carries the one count: the rows to justify plus the documents to review", () => {
    const c = navCounts(open({ rowsToJustify: 6, documentsToReview: 2, overdueInvoices: 1 }));
    expect(c["/work"]).toBe(8);
    expect(c["/banking"]).toBe(6);
    expect(c["/documents"]).toBe(2);
    expect(c["/invoices"]).toBe(1);
  });

  test("Work counts only the loop's two: overdue invoices, supplier invoices and rate gaps stay on their item", () => {
    const c = navCounts(open({ overdueInvoices: 3, overdueSupplierInvoices: 4, rateGapDays: 5 }));
    expect(c["/work"]).toBe(0);
    expect(c["/supplier-invoices"]).toBe(4);
    expect(c["/rates"]).toBe(5);
  });

  test("nothing open: every number is 0 (the rail shows no badge)", () => {
    expect(Object.values(navCounts(open())).every((n) => n === 0)).toBe(true);
  });

  test("every key is an enabled nav path the owner sees — a moved item cannot lose its badge silently", () => {
    const owner = filterNavItems(NAV_ITEMS, "owner").map((i) => i.path);
    for (const key of Object.keys(navCounts(open()))) expect(owner).toContain(key);
  });

  test("the linking inbox has no badge of its own: it is Banking › Inbox, its rows are Work's and Banking's", () => {
    expect(navCounts(open({ rowsToJustify: 1 }))["/banking/inbox"]).toBeUndefined();
  });
});
