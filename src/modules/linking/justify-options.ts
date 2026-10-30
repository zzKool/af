// The option lists the Justify panel's card needs (F97): the expense groups, the expense categories (the ones with
// a short code — a key needs one) and the partners — read through the owning modules'
// indices, composed here for the pages (`justifyOptions`). Server-only.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as expenses from "@/modules/expenses";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";

/** Plain data for the panel — the type lives with the component (`JustifyOptions` in `components/justify-panel.tsx`). */
export async function justifyOptions(tx: TransactionClient, caller: CallerIdentity) {
  const page = await expenses.expensePageOptions(tx, caller, {
    documents: false,
    transactions: false,
  });
  const partners = await banking.partnerOptions(tx);
  return {
    groups: page.groups.map((g) => ({ id: g.id, label: `${g.number} — ${g.description}` })),
    categories: page.categories,
    partners,
    // per partner, the accounts used before — every module's entries and the rows categorised by hand (F125 PR 2)
    basHistory: settings.mergeBasUsage([
      await expenses.partnerBasUsage(tx),
      await supplierInvoices.partnerBasUsage(tx),
      await banking.partnerBasUsage(tx),
    ]),
  };
}
