// What the supplier-invoices pages load server-side besides their own list: the option lists the dialog and the
// panel need. Server-only (imports the services); pages import it through index.ts.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as expenses from "@/modules/expenses";
import * as settings from "@/modules/settings";
import { candidateDocuments, supplierOptions } from "./queries";
import type {
  CategoryOption,
  DocumentOption,
  GroupOption,
  RegistrationOption,
  SupplierOption,
} from "./types";

export type SupplierInvoicePageOptions = {
  groups: GroupOption[];
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  registrations: RegistrationOption[];
  documents: DocumentOption[];
};

export async function supplierInvoicePageOptions(
  tx: TransactionClient,
  caller: CallerIdentity,
  options: { documents?: boolean } = {},
): Promise<SupplierInvoicePageOptions> {
  const groups = await expenses.listGroups(tx);
  const categories = await expenses.expenseCategoryOptions(tx, caller);
  const suppliers = await supplierOptions(tx);
  const regs = await settings.getVatRegistrations(tx, caller);
  const documents = options.documents === false ? [] : await candidateDocuments(tx, caller);
  return {
    groups: groups.map((g) => ({
      id: g.id,
      number: g.number,
      description: g.description,
      kind: g.kind,
    })),
    categories,
    suppliers,
    registrations: (regs.data ?? []).map((r) => ({
      id: r.id,
      label: `${r.country} ${r.vatNumber}`,
      country: r.country,
    })),
    documents,
  };
}
