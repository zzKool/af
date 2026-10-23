import { describe, expect, it } from "vitest";
import { toSupplierInvoiceDetailWire } from "./detail-wire";
import type { SupplierInvoiceDetail } from "./queries";

describe("toSupplierInvoiceDetailWire (audit 29)", () => {
  it("turns every timestamp into its ISO string and keeps the rest", () => {
    const created = new Date("2026-10-23T08:15:00.000Z");
    const detail = {
      invoice: {
        id: "si-1",
        key: "Ex12-SUB-001_2026-10-01_",
        createdAt: created,
        updatedAt: new Date("2026-10-23T09:00:00.000Z"),
        cancelledAt: null,
      },
      open: "12.50",
      links: [{ id: "l-1", kind: "justifies", createdAt: created, otherLabel: "Nordea" }],
      history: [],
    } as unknown as SupplierInvoiceDetail;

    const wire = toSupplierInvoiceDetailWire(detail);

    expect(wire.invoice.createdAt).toBe("2026-10-23T08:15:00.000Z");
    expect(wire.invoice.updatedAt).toBe("2026-10-23T09:00:00.000Z");
    expect(wire.invoice.cancelledAt).toBeNull();
    expect(wire.links[0]?.createdAt).toBe("2026-10-23T08:15:00.000Z");
    expect(wire.invoice.key).toBe("Ex12-SUB-001_2026-10-01_");
    expect(wire.open).toBe("12.50");
    expect(wire.links[0]?.otherLabel).toBe("Nordea");
  });

  it("keeps a cancellation time", () => {
    const at = new Date("2026-10-20T12:00:00.000Z");
    const detail = {
      invoice: { createdAt: at, updatedAt: at, cancelledAt: at },
      links: [],
    } as unknown as SupplierInvoiceDetail;
    expect(toSupplierInvoiceDetailWire(detail).invoice.cancelledAt).toBe(
      "2026-10-20T12:00:00.000Z",
    );
  });
});
