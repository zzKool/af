// The supplier-invoice detail as it crosses to the browser (audit 29) — pure, a leaf: the action maps the service's
// detail through it, the panel types its state with it, and nothing is cast on the way.
import type { SupplierInvoiceDetail } from "./queries";
import type { SupplierInvoiceDto } from "./types";

/**
 * The detail as it crosses to the browser (the panel): its timestamps as ISO strings, so the type the panel reads is
 * the value it gets (audit 29) — no cast on the client side.
 */
export type SupplierInvoiceDetailWire = Omit<SupplierInvoiceDetail, "invoice" | "links"> & {
  invoice: Omit<SupplierInvoiceDto, "createdAt" | "updatedAt" | "cancelledAt"> & {
    createdAt: string;
    updatedAt: string;
    cancelledAt: string | null;
  };
  links: (Omit<SupplierInvoiceDetail["links"][number], "createdAt"> & { createdAt: string })[];
};

export function toSupplierInvoiceDetailWire(d: SupplierInvoiceDetail): SupplierInvoiceDetailWire {
  return {
    ...d,
    invoice: {
      ...d.invoice,
      createdAt: d.invoice.createdAt.toISOString(),
      updatedAt: d.invoice.updatedAt.toISOString(),
      cancelledAt: d.invoice.cancelledAt?.toISOString() ?? null,
    },
    links: d.links.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
  };
}
