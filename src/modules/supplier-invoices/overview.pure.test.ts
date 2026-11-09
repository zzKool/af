// The supplier invoices hero (F164) — pure: the year's costs in the base, cancelled ones left out, the split.
import { describe, expect, it } from "vitest";
import { type SupplierOverviewRow, supplierOverviewFrom } from "./overview";

const row = (o: Partial<SupplierOverviewRow>): SupplierOverviewRow => ({
  invoiceDate: "2026-03-10",
  amountBase: "1000.00",
  basLabel: "IT services",
  basCode: "6540",
  cancelled: false,
  documentMissing: false,
  status: "paid",
  ...o,
});

describe("supplierOverviewFrom", () => {
  it("the year, the same span last year, months amber while unpaid, the categories ranked", () => {
    const o = supplierOverviewFrom(
      [
        row({}),
        row({
          invoiceDate: "2026-07-01",
          status: "unpaid",
          basLabel: "Rent",
          amountBase: "3000.00",
        }),
        row({ cancelled: true, amountBase: "9999.00" }),
        row({ invoiceDate: "2025-02-01", documentMissing: true }),
      ],
      "2026-07-15",
    );
    expect(o.costYear).toBe("4000.00");
    expect(o.costLastYear).toBe("1000.00");
    expect(o.months.at(-1)).toEqual({ month: "2026-07", base: "3000.00", open: true });
    expect(o.categories[0]).toEqual({ label: "Rent", base: "3000.00" });
    expect(o.missingDocuments).toBe(1);
  });
});
