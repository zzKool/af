// Registration of every module's linkable. Importing this file (done by index.ts and the actions) is what
// makes an entity type known to the linking module. New module → add one line here.
// Namespace imports + a thunk: the bindings are read on first use, after every module finished loading
// (each module imports linking, so the graph is cyclic and a direct read here could see `undefined`).
import * as banking from "@/modules/banking";
import * as contracts from "@/modules/contracts";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as invoices from "@/modules/invoices";
import * as journal from "@/modules/journal";
import * as partners from "@/modules/partners";
import * as subscriptions from "@/modules/subscriptions";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { provideLinkables } from "./linkable";

provideLinkables(() => [
  partners.partnerLinkable,
  contracts.contractLinkable,
  documents.documentLinkable,
  invoices.invoiceLinkable,
  banking.bankTransactionLinkable,
  journal.journalEntryLinkable,
  expenses.expenseLinkable,
  expenses.settlementLinkable,
  supplierInvoices.supplierInvoiceLinkable,
  subscriptions.subscriptionLinkable,
]);
