// The collector (specs/accountant-package/spec.md FR-002, FR-004): everything of one period, read through the
// owning modules' queries — the package never recomputes a business rule (harvest §4.3). Returns `PeriodData`,
// plain and serialisable; the generators (csv, summary, notes, zip) are pure over it.
//
// Selection: main-account rows by booking date; savings rows by the month their export was imported (D31; by
// booking date for the year); invoices issued in the period ∪ justified by a period row; supplier invoices and
// expenses dated in the period ∪ justified by a period row; settlements settled by a period row. Documents: the
// invoice PDFs, the `created_from` documents, the per-diem breakdowns, the statements, the documents a row
// justifies directly — each once, under its business key.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ListQuery } from "@/kernel/list-query/types";
import { settlementTolerance } from "@/kernel/money/settlement";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as invoices from "@/modules/invoices";
import * as journal from "@/modules/journal";
import type { LinkDto, LinkEndpoint } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import * as traktamente from "@/modules/traktamente";
import type {
  BankSheetRow,
  ExpenseRow,
  IncomeRow,
  LinkRow,
  PackageDocument,
  PackageFlag,
  PackageFolder,
  PackagePeriod,
  PeriodData,
  SettlementRow,
  SupplierRow,
  TransferNote,
  VatPeriodNote,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** The whole table, in the module's default order — the lists are small (one company) and capped by the modules. */
const ALL: ListQuery = { page: 1, pageSize: 100_000, sort: [], filters: {} };

const inPeriod = (date: string | null, p: PackagePeriod): boolean =>
  date !== null && date >= p.from && date <= p.to;

const money = (amount: string, currency: string): string => `${amount} ${currency}`;

/** `.pdf` from `receipt.pdf`; "" when the file has no extension. */
export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(i).toLowerCase() : "";
}

/** The file name a document takes in the zip: its business key, with the original extension when the key lacks it. */
export function packageFileName(businessKey: string, fileName: string): string {
  const ext = extensionOf(fileName);
  return ext && !businessKey.toLowerCase().endsWith(ext) ? `${businessKey}${ext}` : businessKey;
}

export const UNKNOWN_LABEL = "?";

type KeyIndex = Map<string, string>;
const endpointKey = (e: LinkEndpoint): string => `${e.type}:${e.id}`;

export async function collectPeriod(
  tx: TransactionClient,
  period: PackagePeriod,
  today: string,
): Promise<PeriodData> {
  // --- 1. the rows ---
  const mainRows = await banking.rawRowsForPeriod(tx, {
    from: period.from,
    to: period.to,
    by: "booking",
    role: "main",
  });
  const savingsRows = await banking.rawRowsForPeriod(tx, {
    from: period.from,
    to: period.to,
    by: period.kind === "month" ? "import" : "booking",
    role: "savings",
  });
  const rows = [...mainRows, ...savingsRows];
  const rowIds = rows.map((r) => r.id);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const [entries, rowLinks, rowStates] = await Promise.all([
    journal.entriesForSources(tx, "bank_transaction", rowIds),
    linking.linksTouching(tx, "bank_transaction", rowIds),
    // the row's state with its allocation and transfer facts — banking's own derivation (lessons audit 23)
    banking.transactionStates(tx, rowIds),
  ]);

  // --- 2. what the rows point at ---
  const justified = new Map<string, Set<string>>(); // type → ids justified by a period row
  const settledIds = new Set<string>();
  const transferPairs: [string, string][] = [];
  for (const l of rowLinks) {
    if (l.kind === "justifies" && l.from.type === "bank_transaction" && rowById.has(l.from.id)) {
      const set = justified.get(l.to.type) ?? new Set<string>();
      set.add(l.to.id);
      justified.set(l.to.type, set);
    } else if (l.kind === "settles" && rowById.has(l.from.id)) {
      settledIds.add(l.to.id);
    } else if (l.kind === "transfer") {
      transferPairs.push([l.from.id, l.to.id]);
    }
  }
  const justifiedOf = (type: string): Set<string> => justified.get(type) ?? new Set();

  // --- 3. the entities: dated in the period ∪ justified by a period row ---
  const [invoiceList, supplierList, expenseList, settlementList, ledger] = await Promise.all([
    invoices.listInvoices(tx, ALL, today),
    supplierInvoices.listSupplierInvoices(tx, ALL, { today }),
    expenses.listExpenses(tx, ALL),
    expenses.listSettlements(tx),
    expenses.ledgerSnapshot(tx),
  ]);

  const invoiceRows = invoiceList.rows.filter(
    (i) =>
      i.type !== "quote" &&
      i.status !== "draft" &&
      i.number !== null &&
      (inPeriod(i.issueDate, period) || justifiedOf("invoice").has(i.id)),
  );
  const supplierRows = supplierList.rows.filter(
    (s) =>
      !s.cancelled &&
      (inPeriod(s.invoiceDate, period) || justifiedOf("supplier_invoice").has(s.id)),
  );
  const expenseRows = expenseList.rows.filter(
    (e) => inPeriod(e.date, period) || justifiedOf("expense").has(e.id),
  );
  const activeSettlements = settlementList.filter((s) => s.status === "active");
  const settlementRows = activeSettlements.filter((s) => settledIds.has(s.id));

  // deterministic order (R6): by key / number, then id
  invoiceRows.sort(
    (a, b) => (a.number ?? "").localeCompare(b.number ?? "") || a.id.localeCompare(b.id),
  );
  supplierRows.sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  expenseRows.sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  settlementRows.sort((a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id));

  // --- 4. the entities' own links (documents they became from, the rows that paid them) ---
  const [invoiceDetails, supplierLinks, expenseLinks, perDiemDocs] = await Promise.all([
    Promise.all(invoiceRows.map((i) => invoices.getInvoice(tx, i.id, today))),
    linking.linksTouching(
      tx,
      "supplier_invoice",
      supplierRows.map((s) => s.id),
    ),
    linking.linksTouching(
      tx,
      "expense",
      expenseRows.map((e) => e.id),
    ),
    traktamente.perDiemDocumentsFor(
      tx,
      expenseRows.filter((e) => e.kind === "per_diem").map((e) => e.id),
    ),
  ]);

  // --- 5. the documents ---
  const wanted = new Map<string, PackageFolder>(); // document id → folder
  const want = (id: string | null | undefined, folder: PackageFolder) => {
    if (id && !wanted.has(id)) wanted.set(id, folder);
  };
  const invoicePdf = new Map<string, string | null>();
  invoiceDetails.forEach((d, i) => {
    const row = invoiceRows[i];
    if (!row) return;
    invoicePdf.set(row.id, d.data?.pdfDocumentId ?? null);
    want(d.data?.pdfDocumentId, "client-invoices");
  });
  const originOf = new Map<string, string>(); // entity id → created_from document id
  for (const l of [...supplierLinks, ...expenseLinks]) {
    if (l.kind === "created_from") originOf.set(l.from.id, l.to.id);
  }
  for (const s of supplierRows) want(originOf.get(s.id), "supplier-invoices");
  for (const e of expenseRows) {
    want(originOf.get(e.id), "expenses");
    want(perDiemDocs.get(e.id), "expenses");
  }
  for (const s of settlementRows) want(s.statementDocumentId, "expenses");
  for (const id of justifiedOf("document")) want(id, "documents");
  const docFiles = await documents.documentsByIds(tx, [...wanted.keys()]);
  const docById = new Map(docFiles.map((d) => [d.id, d]));
  const packageDocuments: PackageDocument[] = docFiles
    .map((d) => ({
      id: d.id,
      folder: wanted.get(d.id) as PackageFolder,
      fileName: packageFileName(d.businessKey, d.fileName),
      businessKey: d.businessKey,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
    }))
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.fileName.localeCompare(b.fileName));

  // --- 6. the key index: every endpoint the sheets name ---
  const keys: KeyIndex = new Map();
  const rowLabel = (r: {
    accountLabel: string;
    bookingDate: string;
    amount: string;
    currency: string;
  }) => `${r.accountLabel} ${r.bookingDate} ${money(r.amount, r.currency)}`;
  for (const r of rows) keys.set(`bank_transaction:${r.id}`, rowLabel(r));
  for (const i of invoiceRows) keys.set(`invoice:${i.id}`, i.number ?? i.id);
  for (const s of supplierRows) keys.set(`supplier_invoice:${s.id}`, s.key);
  for (const e of expenseRows) keys.set(`expense:${e.id}`, e.key);
  for (const s of activeSettlements) keys.set(`settlement:${s.id}`, s.number);
  for (const d of docFiles) keys.set(`document:${d.id}`, d.businessKey);
  const allLinks = dedupeLinks([...rowLinks, ...supplierLinks, ...expenseLinks]);
  await resolveMissingKeys(tx, keys, allLinks);

  // --- 7. the bank sheet ---
  const labels = await settings.basLabels(
    tx,
    [...entries.values()].flatMap((e) => (e.basCode ? [e.basCode] : [])),
  );
  const linksFrom = new Map<string, LinkDto[]>();
  for (const l of rowLinks) {
    for (const end of [l.from, l.to]) {
      if (end.type !== "bank_transaction" || !rowById.has(end.id)) continue;
      const list = linksFrom.get(end.id) ?? [];
      if (!list.includes(l)) list.push(l);
      linksFrom.set(end.id, list);
    }
  }
  const flags: PackageFlag[] = [];
  const bank: BankSheetRow[] = rows.map((r) => {
    const e = entries.get(r.id) ?? null;
    const own = linksFrom.get(r.id) ?? [];
    const related: string[] = [];
    for (const l of own) {
      const other = l.from.type === "bank_transaction" && l.from.id === r.id ? l.to : l.from;
      const key = keys.get(endpointKey(other)) ?? UNKNOWN_LABEL;
      if (l.kind === "transfer") related.push(`transfer ↔ ${key}`);
      else if (l.kind === "settles") related.push(`settles ${key}`);
      else related.push(key);
    }
    // every period row is banking's own, so it has a state; the fallback is an unreachable "no links"
    const facts = rowStates.get(r.id) ?? { state: "open", allocated: "0.00", inTransfer: false };
    const status = facts.state;
    const allocated = new D(facts.allocated);
    const abs = new D(r.amount).abs();
    const delta = status === "linked" || status === "no_document" ? new D(0) : abs.minus(allocated);
    const rowFlags: string[] = [];
    if (r.accountRole === "main" && status === "open") {
      rowFlags.push("unlinked");
      flags.push({
        kind: "unlinked_row",
        entity: "bank_transaction",
        id: r.id,
        key: rowLabel(r),
        detail: r.description,
        amount: r.amount,
        currency: r.currency,
        account: r.accountLabel,
        date: r.bookingDate,
      });
    } else if (r.accountRole === "main" && status === "partial") {
      const tolerance = settlementTolerance(abs);
      if (delta.gt(tolerance)) {
        rowFlags.push("delta");
        flags.push({
          kind: "delta",
          entity: "bank_transaction",
          id: r.id,
          key: rowLabel(r),
          detail: `allocated ${money(allocated.toFixed(2), r.currency)}, ${money(delta.toFixed(2), r.currency)} open`,
          amount: delta.toFixed(2),
          currency: r.currency,
          account: r.accountLabel,
          date: r.bookingDate,
        });
      }
    }
    return {
      id: r.id,
      account: r.accountLabel,
      accountRole: r.accountRole,
      bookingDate: r.bookingDate,
      amount: r.amount,
      currency: r.currency,
      balance: r.balance,
      sender: r.sender,
      recipient: r.recipient,
      name: r.name,
      additionalDetails: r.additionalDetails,
      message: r.message,
      ownNotes: r.ownNotes,
      counterpartyKey: r.counterpartyKey,
      basCode: e?.basCode ?? null,
      basLabel: e?.basCode ? (labels.get(e.basCode) ?? e.basCode) : null,
      rate: e?.rate ?? null,
      rateSource: e?.rateSource ?? null,
      amountBase: e?.amountBase ?? null,
      related: related.sort(),
      allocated: allocated.toFixed(2),
      delta: delta.toFixed(2),
      status,
      note: e?.note ?? null,
      flags: rowFlags,
      importFileName: r.importFileName,
      rowIndex: r.rowIndex,
      delimiter: r.delimiter,
      decimalSeparator: r.decimalSeparator,
    };
  });

  // --- 8. income ---
  const income: IncomeRow[] = invoiceDetails.flatMap((d, idx) => {
    const row = invoiceRows[idx];
    const inv = d.data;
    if (!row || !inv || !inv.number) return [];
    const reasons: string[] = [];
    if (inPeriod(inv.issueDate, period)) reasons.push("issued");
    if (justifiedOf("invoice").has(inv.id)) reasons.push("paid");
    const rowFlags: string[] = [];
    const pdf = inv.pdfDocumentId ? docById.get(inv.pdfDocumentId) : undefined;
    if (!pdf) {
      rowFlags.push("pdf not ready");
      flags.push({
        kind: "document_not_ready",
        entity: "invoice",
        id: inv.id,
        key: inv.number,
        detail: "the PDF has not been rendered yet",
      });
    }
    const settled = inv.state === "paid" || inv.state === "credited" || inv.type === "credit_note";
    if (!settled) {
      rowFlags.push("unpaid");
      flags.push({
        kind: "unpaid_invoice",
        entity: "invoice",
        id: inv.id,
        key: inv.number,
        detail: `${inv.state.replace("_", " ")}, ${money(inv.remaining, inv.currency)} open`,
        amount: inv.remaining,
        currency: inv.currency,
      });
    }
    return [
      {
        id: inv.id,
        number: inv.number,
        type: inv.type as "invoice" | "credit_note",
        client: row.partnerName,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        periodLabel: inv.periodLabel,
        currency: inv.currency,
        net: inv.netAmount,
        vatRates: inv.vatByRate.map((v) => `${v.rate} %`).join(", "),
        vat: inv.vatAmount,
        total: inv.totalAmount,
        totalBase: inv.totalBase,
        paid: inv.allocated,
        remaining: inv.remaining,
        status: inv.state,
        declarationPeriod: inv.declarationPeriod,
        pdfKey: pdf?.businessKey ?? null,
        reason: reasons.join(", "),
        flags: rowFlags,
      },
    ];
  });

  // --- 9. supplier invoices ---
  const paidVia = new Map<string, string[]>();
  for (const l of supplierLinks) {
    if (l.kind === "justifies" && l.from.type === "bank_transaction") {
      const list = paidVia.get(l.to.id) ?? [];
      list.push(keys.get(endpointKey(l.from)) ?? UNKNOWN_LABEL);
      paidVia.set(l.to.id, list);
    }
  }
  const suppliers: SupplierRow[] = supplierRows.map((s) => {
    const origin = originOf.get(s.id);
    const doc = origin ? docById.get(origin) : undefined;
    const rowFlags: string[] = [];
    // the owner's rule (supplier invoices' `hasDocument`), not a second one here (lessons audit 26)
    if (!s.hasDocument) {
      rowFlags.push("missing document");
      flags.push({
        kind: "missing_document",
        entity: "supplier_invoice",
        id: s.id,
        key: s.key,
        detail: `${s.partnerName} ${s.invoiceNumber}`,
      });
    }
    const reasons: string[] = [];
    if (inPeriod(s.invoiceDate, period)) reasons.push("dated");
    if (justifiedOf("supplier_invoice").has(s.id)) reasons.push("paid");
    return {
      id: s.id,
      key: s.key,
      supplier: s.partnerName,
      invoiceNumber: s.invoiceNumber,
      invoiceDate: s.invoiceDate,
      dueDate: s.dueDate,
      currency: s.currency,
      net: s.amountNet,
      vat: s.vatAmount,
      total: s.amountTotal,
      amountBase: s.amountBase,
      rateSource: s.rateSource,
      basCode: s.basCode,
      basLabel: s.basLabel,
      paid: s.allocated,
      open: s.open,
      status: s.status,
      paidVia: (paidVia.get(s.id) ?? []).sort(),
      documentKey: doc?.businessKey ?? "MISSING",
      reason: reasons.join(", "),
      note: s.note,
      flags: rowFlags,
    };
  });

  // --- 10. expenses + settlements ---
  const settlementOf = new Map<string, { number: string; bookingDate: string | null }>();
  for (const s of activeSettlements) {
    for (const line of s.lines) settlementOf.set(line.expenseId, s);
  }
  const expenseKey = new Map(expenseList.rows.map((e) => [e.id, e.key]));
  const expenseRowsOut: ExpenseRow[] = expenseRows.map((e) => {
    const origin = originOf.get(e.id) ?? perDiemDocs.get(e.id);
    const doc = origin ? docById.get(origin) : undefined;
    const rowFlags: string[] = [];
    // the owner's rule (expenses' `hasDocument`; a per-diem breakdown is a `created_from` document too)
    if (!e.hasDocument) {
      rowFlags.push("missing document");
      flags.push({
        kind: "missing_document",
        entity: "expense",
        id: e.id,
        key: e.key,
        detail: e.description,
      });
    }
    const reasons: string[] = [];
    if (inPeriod(e.date, period)) reasons.push("dated");
    if (justifiedOf("expense").has(e.id)) reasons.push("paid");
    const settlement = settlementOf.get(e.id);
    return {
      id: e.id,
      group: `${e.groupNumber} ${e.groupDescription}`,
      key: e.key,
      description: e.description,
      date: e.date,
      basCode: e.basCode,
      basLabel: e.basLabel,
      alias: e.alias,
      amount: e.amount,
      currency: e.currency,
      rateSource: e.rateSource,
      amountBase: e.amountBase,
      paidBy: e.paymentSourceLabel,
      status: e.status,
      refundDate: settlement?.bookingDate ?? null,
      settlement: settlement?.number ?? null,
      documentKey: doc?.businessKey ?? "MISSING",
      reason: reasons.join(", "),
      note: e.note,
      flags: rowFlags,
    };
  });
  const settlements: SettlementRow[] = settlementRows.map((s) => {
    const doc = s.statementDocumentId ? docById.get(s.statementDocumentId) : undefined;
    const rowFlags: string[] = [];
    if (!doc) {
      rowFlags.push("statement not ready");
      flags.push({
        kind: "document_not_ready",
        entity: "settlement",
        id: s.id,
        key: s.number,
        detail: "the reimbursement statement has not been rendered yet",
      });
    }
    return {
      id: s.id,
      number: s.number,
      bookingDate: s.bookingDate,
      paidBy: s.paymentSourceLabel,
      refundAmount: s.refundAmount,
      currency: s.refundCurrency,
      refundBase: s.refundBase,
      allocatedBase: s.allocatedBase,
      exchangeDifferenceBase: s.exchangeDifferenceBase,
      roundingBase: s.roundingBase,
      expenses: s.lines.map((l) => expenseKey.get(l.expenseId) ?? UNKNOWN_LABEL).sort(),
      statementKey: doc?.businessKey ?? null,
      flags: rowFlags,
    };
  });

  // --- 11. links, transfers, liability, VAT ---
  const links: LinkRow[] = allLinks
    .map((l) => ({
      id: l.id,
      fromType: l.from.type,
      fromKey: keys.get(endpointKey(l.from)) ?? UNKNOWN_LABEL,
      toType: l.to.type,
      toKey: keys.get(endpointKey(l.to)) ?? UNKNOWN_LABEL,
      kind: l.kind,
      allocated: l.allocatedAmount,
      currency: l.currency,
      createdAt: l.createdAt.toISOString(),
    }))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.fromKey.localeCompare(b.fromKey) ||
        a.id.localeCompare(b.id),
    );

  const transfers: TransferNote[] = [];
  const seenPairs = new Set<string>();
  for (const [fromId, toId] of transferPairs) {
    const pairKey = [fromId, toId].sort().join("|");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const from = rowById.get(fromId) ?? (await banking.getBankTransaction(tx, fromId));
    const to = rowById.get(toId) ?? (await banking.getBankTransaction(tx, toId));
    if (!from || !to) continue;
    const implied = impliedRate(from.amount, to.amount);
    transfers.push({
      date: from.bookingDate < to.bookingDate ? from.bookingDate : to.bookingDate,
      from: rowLabel(from),
      to: rowLabel(to),
      implied,
    });
  }
  transfers.sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from));

  const liability = ledger.sources
    .filter((s) => s.openCount > 0)
    .map((s) => ({
      source: s.label,
      currency: s.currency,
      openBase: s.openBase,
      openCount: s.openCount,
    }))
    .sort((a, b) => a.source.localeCompare(b.source));

  const vatPeriods = vatPeriodTotals(income);

  return {
    period,
    bank,
    income,
    suppliers,
    expenses: expenseRowsOut,
    settlements,
    links,
    flags,
    transfers,
    liability,
    vatPeriods,
    documents: packageDocuments,
    collectedAt: today,
  };
}

/** to / from of a transfer pair's amounts, as the implied rate (six decimals); "" when a side is zero. */
export function impliedRate(fromAmount: string, toAmount: string): string {
  const from = new D(fromAmount).abs();
  const to = new D(toAmount).abs();
  if (from.isZero() || to.isZero()) return "";
  return to.div(from).toFixed(6);
}

function dedupeLinks(links: LinkDto[]): LinkDto[] {
  const seen = new Set<string>();
  const out: LinkDto[] = [];
  for (const l of links) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out;
}

/** Endpoints the period did not select (a partner, a journal entry, a row of another month) get their linkable's label. */
async function resolveMissingKeys(
  tx: TransactionClient,
  keys: KeyIndex,
  links: LinkDto[],
): Promise<void> {
  const missing = new Map<string, LinkEndpoint>();
  for (const l of links) {
    for (const end of [l.from, l.to]) {
      const k = endpointKey(end);
      if (!keys.has(k) && !missing.has(k)) missing.set(k, end);
    }
  }
  for (const [k, end] of missing) {
    if (end.type === "bank_transaction") {
      const row = await banking.getBankTransaction(tx, end.id);
      if (row)
        keys.set(k, `${row.accountLabel} ${row.bookingDate} ${money(row.amount, row.currency)}`);
      continue;
    }
    if (end.type === "document") {
      const [doc] = await documents.documentsByIds(tx, [end.id]);
      if (doc) keys.set(k, doc.businessKey);
      continue;
    }
    const summary = await linking.getLinkable(end.type)?.summary(tx, end.id);
    if (summary) keys.set(k, summary.label);
  }
}

/** Swiss VAT declaration periods touched by the period's invoices: totals per period and currency. */
export function vatPeriodTotals(income: IncomeRow[]): VatPeriodNote[] {
  const totals = new Map<string, { count: number; net: Dec; vat: Dec; total: Dec }>();
  for (const i of income) {
    if (!i.declarationPeriod) continue;
    const k = `${i.declarationPeriod}|${i.currency}`;
    const t = totals.get(k) ?? { count: 0, net: new D(0), vat: new D(0), total: new D(0) };
    const sign = i.type === "credit_note" ? -1 : 1;
    t.count += 1;
    t.net = t.net.plus(new D(i.net).mul(sign));
    t.vat = t.vat.plus(new D(i.vat).mul(sign));
    t.total = t.total.plus(new D(i.total).mul(sign));
    totals.set(k, t);
  }
  return [...totals.entries()]
    .map(([k, t]) => {
      const [declarationPeriod, currency] = k.split("|") as [string, string];
      return {
        declarationPeriod,
        currency,
        count: t.count,
        net: t.net.toFixed(2),
        vat: t.vat.toFixed(2),
        total: t.total.toFixed(2),
      };
    })
    .sort(
      (a, b) =>
        a.declarationPeriod.localeCompare(b.declarationPeriod) ||
        a.currency.localeCompare(b.currency),
    );
}

/** Also used by the page: the live counts and flags of a month without building it. */
export function countsOf(data: PeriodData) {
  return {
    bankRows: data.bank.length,
    invoices: data.income.length,
    supplierInvoices: data.suppliers.length,
    expenses: data.expenses.length,
    settlements: data.settlements.length,
    documents: data.documents.length,
  };
}
