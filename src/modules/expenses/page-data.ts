// What the expenses pages load server-side besides their own list: the option lists the dialogs and panels need.
// Server-only (imports the services); pages import it through index.ts.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { listPaymentSources } from "./payment-sources";
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
  sources: SourceOption[];
  documents: DocumentOption[];
  transactions: TransactionOption[];
};

/** The tenant's active BAS set (favourites first) as `580 · Resekostnader (Tr)` — only categories with a short code can key an expense, so those come first. */
export async function expenseCategoryOptions(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<CategoryOption[]> {
  const prefs = await settings.getTenantBasPreferences(tx, caller);
  const codes = (prefs.data ?? []).map((p) => p.basCode);
  const aliases = await settings.basAliases(tx, codes);
  return (prefs.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(Boolean(aliases.get(b.basCode))) - Number(Boolean(aliases.get(a.basCode))) ||
        Number(b.isFavorite) - Number(a.isFavorite) ||
        a.basCode.localeCompare(b.basCode),
    )
    .map((p) => {
      const alias = aliases.get(p.basCode);
      return {
        code: p.basCode,
        label: `${p.basCode} · ${p.basCategory.name}${alias ? ` (${alias})` : ""}`,
      };
    });
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
  const [groups, categories, sources, documents, transactions] = await Promise.all([
    listGroups(tx),
    expenseCategoryOptions(tx, caller),
    listPaymentSources(tx),
    options.documents === false ? Promise.resolve([]) : candidateDocuments(tx, caller),
    options.transactions === false ? Promise.resolve([]) : settleableTransactions(tx),
  ]);
  return {
    groups: groups.map((g) => ({
      id: g.id,
      number: g.number,
      description: g.description,
      kind: g.kind,
    })),
    categories,
    sources: sources.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      bankAccountId: s.bankAccountId,
      currency: s.currency,
      isActive: s.isActive,
    })),
    documents,
    transactions,
  };
}
