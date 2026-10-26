// Global search (F93, D56) — the composition root of the palette. The kernel's palette knows no module; each
// module owns its `search<Kind>Hits`; this file, like the layout's sidebar counts, is where they meet. No registry
// importing every module at load (docs/lessons.md, the linking cycle): one list, read when a search runs.
// Not a "use server" file on purpose: `searchAll` takes a transaction and must never become a callable action.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { orderGroups } from "@/kernel/search/query";
import type { SearchGroup } from "@/kernel/search/types";
import { searchBankTransactionHits } from "@/modules/banking";
import { searchDocumentHits } from "@/modules/documents";
import { searchExpenseHits, searchSettlementHits } from "@/modules/expenses";
import { searchInvoiceHits } from "@/modules/invoices";
import { searchPartnerHits } from "@/modules/partners";
import { searchSubscriptionHits } from "@/modules/subscriptions";
import { searchSupplierInvoiceHits } from "@/modules/supplier-invoices";

type Search = (
  tx: TransactionClient,
  caller: CallerIdentity,
  q: string,
) => Promise<ServiceResult<SearchGroup>>;

/** One line per searchable kind — a new module joins here (specs/search/spec.md *How modules plug in*). */
const SEARCHES: Search[] = [
  searchPartnerHits,
  searchInvoiceHits,
  searchSupplierInvoiceHits,
  searchExpenseHits,
  searchSettlementHits,
  searchSubscriptionHits,
  searchDocumentHits,
  searchBankTransactionHits,
];

/** Every module's group for the query, in one tenant transaction (RLS) — sequential: a transaction is one connection. */
export async function searchAll(
  tx: TransactionClient,
  caller: CallerIdentity,
  q: string,
): Promise<SearchGroup[]> {
  const groups: SearchGroup[] = [];
  for (const search of SEARCHES) {
    const result = await search(tx, caller, q);
    if (result.data) groups.push(result.data);
  }
  return orderGroups(groups);
}
