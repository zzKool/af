// The supplier list of the new-invoice dialog: the page's suppliers plus the ones created from the dialog's match
// card. The page refreshes after a creation (router.refresh), so a created supplier soon comes back in `suppliers`
// too — the page's row wins (it carries the real defaults) and each id appears once.
import type { SupplierOption } from "./types";

export function withCreatedSuppliers(
  created: readonly SupplierOption[],
  suppliers: readonly SupplierOption[],
): SupplierOption[] {
  const known = new Set(suppliers.map((s) => s.id));
  const pending: SupplierOption[] = [];
  for (const s of created) {
    if (known.has(s.id)) continue;
    known.add(s.id);
    pending.push(s);
  }
  return [...pending, ...suppliers];
}
