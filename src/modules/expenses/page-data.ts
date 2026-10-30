// What the expenses pages load server-side besides their own list: the option lists the dialogs and panels need.
// Server-only (imports the services); pages import it through index.ts.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { partnerBasUsage } from "./partner-bas-usage";
import { candidateDocuments, listGroups, settleableTransactions } from "./queries";
import type {
  CategoryOption,
  DocumentOption,
  GroupOption,
  SourceOption,
  TransactionOption,
  VendorOption,
} from "./types";

export type ExpensePageOptions = {
  groups: GroupOption[];
  categories: CategoryOption[];
  /** per partner, the accounts the owner used before (F125 PR 2) — the picker's *used before* suggestions */
  basHistory: Record<string, { code: string; count: number }[]>;
  sources: SourceOption[];
  documents: DocumentOption[];
  transactions: TransactionOption[];
};

/**
 * The tenant's active BAS set as the picker takes it (F125: settings' one builder — `654 · IT services (It)`, the
 * alias the key needs, the class, the favourite). The picker groups, searches and disables what has no alias.
 */
export async function expenseCategoryOptions(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<CategoryOption[]> {
  return settings.basPickerOptions(tx);
}

/** The partner picker's choices (F87, FR-008): active vendors, by name, with their default category. */
export async function vendorOptions(tx: TransactionClient): Promise<VendorOption[]> {
  const r = await partners.getPartners(tx, { types: ["vendor"] });
  return (r.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    defaultBasCategoryCode: p.defaultBasCategoryCode,
  }));
}

export async function expensePageOptions(
  tx: TransactionClient,
  caller: CallerIdentity,
  options: { documents?: boolean; transactions?: boolean } = {},
): Promise<ExpensePageOptions> {
  const groups = await listGroups(tx);
  const categories = await expenseCategoryOptions(tx, caller);
  const sources = await banking.payerAccounts(tx);
  const documents = options.documents === false ? [] : await candidateDocuments(tx, caller);
  const transactions = options.transactions === false ? [] : await settleableTransactions(tx);
  return {
    groups: groups.map((g) => ({
      id: g.id,
      number: g.number,
      description: g.description,
      kind: g.kind,
    })),
    categories,
    basHistory: settings.mergeBasUsage([
      await partnerBasUsage(tx),
      await banking.partnerBasUsage(tx),
    ]),
    sources: sources.map((s) => ({ id: s.id, label: s.label, kind: s.kind, currency: s.currency })),
    documents,
    transactions,
  };
}
