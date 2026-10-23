// F71: the derived status → D40 family map (one place in the module). Tested on the rule — every status covered,
// only kit families, and what the owner must chase (attention) coming out of deriveSupplierInvoiceStatus.
import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import { SUPPLIER_INVOICE_STATE_FAMILY, supplierInvoiceStateFamily } from "./state-family";
import { deriveSupplierInvoiceStatus } from "./status";
import { SUPPLIER_INVOICE_STATUSES } from "./types";

const TODAY = "2026-07-15";
const familyOf = (input: Partial<Parameters<typeof deriveSupplierInvoiceStatus>[0]>) =>
  supplierInvoiceStateFamily(
    deriveSupplierInvoiceStatus({
      cancelled: false,
      total: "1297.20",
      allocated: "0",
      dueDate: "2026-07-31",
      today: TODAY,
      ...input,
    }).status,
  );

describe("supplier invoice status → family", () => {
  it("maps every derived status, and only to a kit family", () => {
    expect(Object.keys(SUPPLIER_INVOICE_STATE_FAMILY).sort()).toEqual(
      [...SUPPLIER_INVOICE_STATUSES].sort(),
    );
    for (const s of SUPPLIER_INVOICE_STATUSES)
      expect(STATE_FAMILIES).toContain(SUPPLIER_INVOICE_STATE_FAMILY[s]);
  });

  it("only an overdue invoice asks for attention — a partial payment past due still does", () => {
    expect(familyOf({ dueDate: "2026-07-10" })).toBe("attention");
    expect(familyOf({ dueDate: "2026-07-10", allocated: "500.00" })).toBe("attention");
    expect(familyOf({})).toBe("progress");
    expect(familyOf({ allocated: "500.00" })).toBe("progress");
  });

  it("settled is done, cancelled is neutral even when overdue", () => {
    expect(familyOf({ allocated: "1297.20", dueDate: "2026-07-10" })).toBe("done");
    expect(familyOf({ cancelled: true, dueDate: "2026-07-10" })).toBe("neutral");
  });
});
