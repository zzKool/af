// What the subscriptions page loads server-side besides its list (F94 PR4): the option lists the form needs.
// Server-only; the page imports it through index.ts.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as expenses from "@/modules/expenses";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";

export type SubscriptionVendorOption = {
  id: string;
  name: string;
  defaultBasCategoryCode: string | null;
  defaultCurrency: string | null;
};
export type SubscriptionPageOptions = {
  vendors: SubscriptionVendorOption[];
  categories: { code: string; label: string }[];
  groups: { id: string; label: string }[];
  sources: { id: string; label: string; kind: "bank_account" | "private"; currency: string }[];
  registrations: { id: string; label: string }[];
};

export async function subscriptionPageOptions(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<SubscriptionPageOptions> {
  const vendors = await partners.getPartners(tx, { types: ["vendor"] });
  const categories = await expenses.expenseCategoryOptions(tx, caller);
  const groups = await expenses.listGroups(tx);
  const sources = await banking.payerAccounts(tx);
  const regs = await settings.getVatRegistrations(tx, caller);
  return {
    vendors: (vendors.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      defaultBasCategoryCode: p.defaultBasCategoryCode,
      defaultCurrency: p.defaultCurrency,
    })),
    categories,
    groups: groups.map((g) => ({ id: g.id, label: expenses.groupLabel(g) })),
    sources: sources.map((s) => ({ id: s.id, label: s.label, kind: s.kind, currency: s.currency })),
    registrations: (regs.data ?? []).map((r) => ({
      id: r.id,
      label: `${r.country} ${r.vatNumber}`,
    })),
  };
}
