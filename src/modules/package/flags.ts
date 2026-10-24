// The flags of a period without collecting the package (F83): the dashboard's *last month's package* item needs
// the flags, not the sheets, the notes, the key index or the ledger. Same rows, same selection, same builders as
// the collector (`collect.ts`) — only the lists are read in a date window instead of whole: the period, widened to
// the dates of whatever a period row justifies (each owner's linkable `facts`, the date its list filters on), so
// `selectEntities` picks exactly the rows it would pick from the whole lists. `flags.test.ts` holds the two equal.
import { mapInOrder, type TransactionClient } from "@/kernel/db/tenant-client";
import type { Filter, ListQuery } from "@/kernel/list-query/types";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as invoices from "@/modules/invoices";
import type { LinkableType } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as supplierInvoices from "@/modules/supplier-invoices";
import {
  bankRowFacts,
  expenseFlag,
  invoiceFlags,
  periodRows,
  selectEntities,
  settlementFlag,
  supplierInvoiceFlag,
} from "./collect";
import type { PackageFlag, PackagePeriod } from "./types";

/**
 * The window a list is read in: the period, widened to the dates of the `ids` a period row justifies. A
 * justified entity the owner no longer knows (deleted, cancelled — `facts` is null) is one the collector drops.
 */
export async function dateWindow(
  tx: TransactionClient,
  period: PackagePeriod,
  type: LinkableType,
  ids: ReadonlySet<string>,
): Promise<Extract<Filter, { kind: "dates" }>> {
  let from = period.from;
  let to = period.to;
  const linkable = linking.getLinkable(type);
  for (const id of ids) {
    const f = await linkable?.facts?.(tx, id);
    if (!f) continue;
    if (f.date < from) from = f.date;
    if (f.date > to) to = f.date;
  }
  return { kind: "dates", from, to };
}

const within = (column: string, window: Filter): ListQuery => ({
  page: 1,
  pageSize: 100_000,
  sort: [],
  filters: { [column]: window },
});

/** The flags of `period` as the collector would raise them now — same kinds, same order (R7). */
export async function collectFlags(
  tx: TransactionClient,
  period: PackagePeriod,
  today: string,
): Promise<PackageFlag[]> {
  const pr = await periodRows(tx, period);
  const justified = (type: LinkableType) => pr.justified.get(type) ?? new Set<string>();

  const invoiceList = await invoices.listInvoices(
    tx,
    within("issueDate", await dateWindow(tx, period, "invoice", justified("invoice"))),
    today,
  );
  const supplierList = await supplierInvoices.listSupplierInvoices(
    tx,
    within(
      "invoiceDate",
      await dateWindow(tx, period, "supplier_invoice", justified("supplier_invoice")),
    ),
    { today },
  );
  const expenseList = await expenses.listExpenses(
    tx,
    within("date", await dateWindow(tx, period, "expense", justified("expense"))),
  );
  const settlementList = await expenses.listSettlements(tx);
  const { invoiceRows, supplierRows, expenseRows, settlementRows } = selectEntities(
    period,
    {
      invoices: invoiceList.rows,
      suppliers: supplierList.rows,
      expenses: expenseList.rows,
      settlements: settlementList,
    },
    pr,
  );

  // the invoices' state and PDF, the statements: ready = the document is there (the collector's `docById`)
  const details = await mapInOrder(invoiceRows, (i) => invoices.getInvoice(tx, i.id, today));
  const docIds = [
    ...details.flatMap((d) => (d.data?.pdfDocumentId ? [d.data.pdfDocumentId] : [])),
    ...settlementRows.flatMap((s) => (s.statementDocumentId ? [s.statementDocumentId] : [])),
  ];
  const present = new Set(
    (docIds.length ? await documents.documentsByIds(tx, docIds) : []).map((d) => d.id),
  );

  const flags: PackageFlag[] = [];
  for (const r of pr.rows) {
    const { flag } = bankRowFacts(r, pr.rowStates.get(r.id));
    if (flag) flags.push(flag);
  }
  for (const d of details) {
    const inv = d.data;
    if (!inv?.number) continue;
    flags.push(...invoiceFlags(inv, !!inv.pdfDocumentId && present.has(inv.pdfDocumentId)));
  }
  for (const s of supplierRows) {
    const f = supplierInvoiceFlag(s);
    if (f) flags.push(f);
  }
  for (const e of expenseRows) {
    const f = expenseFlag(e);
    if (f) flags.push(f);
  }
  for (const s of settlementRows) {
    const f = settlementFlag(s, !!s.statementDocumentId && present.has(s.statementDocumentId));
    if (f) flags.push(f);
  }
  return flags;
}
