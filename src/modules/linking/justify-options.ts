// The option lists the Justify panel and the reading dialog need (F97, F131): the expense groups (with their kind
// and, for a trip, its first and last day — the dialog proposes the group from the paper's date, review 2026-10-31
// §5.2), the expense categories (the ones with a short code — a key needs one) and the partners — read through the
// owning modules' indices, composed here for the pages (`justifyOptions`). Server-only.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { mapInOrder, type TransactionClient } from "@/kernel/db/tenant-client";
import * as banking from "@/modules/banking";
import * as expenses from "@/modules/expenses";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import * as traktamente from "@/modules/traktamente";

/** Plain data for the panel — the type lives with the component (`JustifyOptions` in `components/justify-panel.tsx`). */
export async function justifyOptions(tx: TransactionClient, caller: CallerIdentity) {
  const page = await expenses.expensePageOptions(tx, caller, {
    documents: false,
    transactions: false,
  });
  const partnerList = await banking.partnerOptions(tx);
  // the VAT numbers: the vendor check compares the paper's with the picked partner's (F130 `vendor_counterparty`)
  const vatNumbers = new Map(
    ((await partners.getPartners(tx, {})).data ?? []).map((p) => [p.id, p.vatNumber ?? null]),
  );
  // F129: the roles whose partner exists but is deactivated — the reasons' line says *inactive*, not nothing
  const system = await partners.systemPartners(tx);
  const inactiveRoles = partners.SYSTEM_ROLES.filter((r) => system[r] && !system[r]?.isActive);
  // the trips' days (Stockholm local, traktamente's rule) — what the dialog proposes a trip group from
  const groups = await mapInOrder(page.groups, async (g) => {
    const trip = g.kind === "trip" ? await traktamente.getTrip(tx, g.id) : null;
    return {
      id: g.id,
      label: `${g.number} — ${g.description}`,
      number: g.number,
      description: g.description,
      kind: g.kind,
      departure: trip ? traktamente.toLocal(trip.departureAt).date : null,
      return: trip ? traktamente.toLocal(trip.returnAt).date : null,
      month: g.month ?? null,
    };
  });
  // F131 §5.1: the fourth exit *This row refunds me* shows only while the owner is owed something (the ledger)
  const ledger = await expenses.ledgerSnapshot(tx);
  return {
    groups,
    categories: page.categories,
    openPrivateCount: ledger.total.openCount,
    partners: partnerList.map((p) => ({
      id: p.id,
      name: p.name,
      defaultBasCode: p.defaultBasCode,
      types: p.types ?? [],
      systemRole: p.systemRole ?? null,
      vatNumber: vatNumbers.get(p.id) ?? null,
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
