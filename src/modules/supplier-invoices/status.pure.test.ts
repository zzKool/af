// Derived status (FR-003, US2-6) — pure.
import { describe, expect, it } from "vitest";
import { addDays, deriveSupplierInvoiceStatus, openAmount } from "./status";

const base = { cancelled: false, total: "1297.20", dueDate: "2026-08-23" };

describe("deriveSupplierInvoiceStatus", () => {
  it("unpaid before the due date, nothing allocated", () => {
    expect(
      deriveSupplierInvoiceStatus({ ...base, allocated: "0.00", today: "2026-08-01" }),
    ).toEqual({ status: "unpaid", daysOverdue: 0 });
  });
  it("partially paid while something is allocated and something open", () => {
    expect(
      deriveSupplierInvoiceStatus({ ...base, allocated: "600.00", today: "2026-08-01" }),
    ).toEqual({ status: "partially_paid", daysOverdue: 0 });
  });
  it("paid when the allocations reach the total — and within the settlement tolerance", () => {
    expect(
      deriveSupplierInvoiceStatus({ ...base, allocated: "1297.20", today: "2026-09-01" }),
    ).toEqual({ status: "paid", daysOverdue: 0 });
    expect(
      deriveSupplierInvoiceStatus({ ...base, allocated: "1297.15", today: "2026-09-01" }),
    ).toEqual({ status: "paid", daysOverdue: 0 });
  });
  it("overdue once the due date passed, with the days; a partial payment is still overdue", () => {
    expect(
      deriveSupplierInvoiceStatus({ ...base, allocated: "0.00", today: "2026-08-30" }),
    ).toEqual({ status: "overdue", daysOverdue: 7 });
    expect(
      deriveSupplierInvoiceStatus({ ...base, allocated: "600.00", today: "2026-08-24" }),
    ).toEqual({ status: "overdue", daysOverdue: 1 });
    expect(
      deriveSupplierInvoiceStatus({ ...base, allocated: "0.00", today: "2026-08-23" }),
    ).toEqual({ status: "unpaid", daysOverdue: 0 });
  });
  it("cancelled wins over everything", () => {
    expect(
      deriveSupplierInvoiceStatus({
        ...base,
        cancelled: true,
        allocated: "0.00",
        today: "2026-12-01",
      }),
    ).toEqual({ status: "cancelled", daysOverdue: 0 });
  });
});

describe("openAmount / addDays", () => {
  it("open never goes negative", () => {
    expect(openAmount("100.00", "40.00").toFixed(2)).toBe("60.00");
    expect(openAmount("100.00", "140.00").toFixed(2)).toBe("0.00");
  });
  it("adds calendar days across month and year ends", () => {
    expect(addDays("2026-07-24", 30)).toBe("2026-08-23");
    expect(addDays("2026-12-20", 20)).toBe("2027-01-09");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
