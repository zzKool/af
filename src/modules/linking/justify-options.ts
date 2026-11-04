// The option lists the Justify panel's card needs (F97): the expense groups, the expense categories (the ones with
// a short code — a key needs one) and the partners — read through the owning modules'
// indices, composed here for the pages (`justifyOptions`). Server-only.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as expenses from "@/modules/expenses";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";

/** Plain data for the panel — the type lives with the component (`JustifyOptions` in `components/justify-panel.tsx`). */
export async function justifyOptions(tx: TransactionClient, caller: CallerIdentity) {
  const page = await expenses.expensePageOptions(tx, caller, {
    documents: false,
    transactions: false,
  });
  const partnerList = await banking.partnerOptions(tx);
  // F129: the roles whose partner exists but is deactivated — the reasons' line says *inactive*, not nothing
  const system = await partners.systemPartners(tx);
  const inactiveRoles = partners.SYSTEM_ROLES.filter((r) => system[r] && !system[r]?.isActive);
  return {
    groups: page.groups.map((g) => ({ id: g.id, label: `${g.number} — ${g.description}` })),
    categories: page.categories,
    partners: partnerList.map((p) => ({
      id: p.id,
      name: p.name,
      defaultBasCode: p.defaultBasCode,
      types: p.types ?? [],
      systemRole: p.systemRole ?? null,
    })),
    inactiveRoles,
    // per partner, the accounts used before — every module's entries and the rows categorised by hand (F125 PR 2)
    basHistory: settings.mergeBasUsage([
      await expenses.partnerBasUsage(tx),
      await supplierInvoices.partnerBasUsage(tx),
      await banking.partnerBasUsage(tx),
    ]),
  };
}
