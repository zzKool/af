// What the supplier-invoices pages load server-side besides their own list: the option lists the dialog and the
// panel need. Server-only (imports the services); pages import it through index.ts.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as expenses from "@/modules/expenses";
import * as settings from "@/modules/settings";
import { partnerBasUsage } from "./partner-bas-usage";
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
  /** per supplier, the accounts the owner used before (F125 PR 2) — the picker's *used before* suggestions */
  basHistory: Record<string, { code: string; count: number }[]>;
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
    // one read after the other: one transaction client (F53)
    basHistory: settings.mergeBasUsage([
      await partnerBasUsage(tx),
      await expenses.partnerBasUsage(tx),
      await banking.partnerBasUsage(tx),
    ]),
    suppliers,
    registrations: (regs.data ?? []).map((r) => ({
      id: r.id,
      label: `${r.country} ${r.vatNumber}`,
      country: r.country,
    })),
    documents,
  };
}
