// `notes.md` — pure (spec FR-004, harvest R7): the flags as prose the accountant reads first, then what is not a
// flag but worth knowing — the transfer pairs with their implied rates, the open owner liability, the Swiss VAT
// declaration periods touched. The same text is stored on the build and previewed on the page.
import type { FlagKind, PackageFlag, PeriodData } from "./types";

export const FLAG_TITLES: Record<FlagKind, string> = {
  missing_document: "Missing documents",
  unlinked_row: "Unlinked bank lines",
  delta: "Deltas beyond tolerance",
  unpaid_invoice: "Invoices issued but unpaid",
  document_not_ready: "Documents not rendered yet",
};

const FLAG_ORDER: FlagKind[] = [
  "missing_document",
  "unlinked_row",
  "delta",
  "unpaid_invoice",
  "document_not_ready",
];

const ENTITY_LABEL: Record<PackageFlag["entity"], string> = {
  bank_transaction: "bank line",
  invoice: "invoice",
  supplier_invoice: "supplier invoice",
  expense: "expense",
  settlement: "settlement",
};

export function notesMd(data: PeriodData): string {
  const out: string[] = [];
  const p = data.period;
  out.push(`# Accountant package ${p.period}`);
  out.push("");
  out.push(
    `${p.kind === "year" ? "Year" : "Month"} ${p.period} (${p.from} → ${p.to}), collected ${data.collectedAt}. ` +
      `${data.bank.length} bank lines · ${data.income.length} client invoices · ${data.suppliers.length} supplier invoices · ` +
      `${data.expenses.length} expenses · ${data.settlements.length} settlements · ${data.documents.length} documents.`,
  );
  out.push("");
  out.push(`## Flags (${data.flags.length})`);
  out.push("");
  if (data.flags.length === 0) {
    out.push("Nothing to ask about: every bank line is justified, every document is there.");
    out.push("");
  }
  for (const kind of FLAG_ORDER) {
    const flags = data.flags.filter((f) => f.kind === kind);
    if (flags.length === 0) continue;
    out.push(`### ${FLAG_TITLES[kind]} (${flags.length})`);
    out.push("");
    for (const f of flags) out.push(`- ${ENTITY_LABEL[f.entity]} **${f.key}** — ${f.detail}`);
    out.push("");
  }

  out.push(`## Transfer pairs (${data.transfers.length})`);
  out.push("");
  if (data.transfers.length === 0) out.push("None in the period.");
  for (const t of data.transfers) {
    out.push(`- ${t.date}: ${t.from} → ${t.to}${t.implied ? ` (implied rate ${t.implied})` : ""}`);
  }
  out.push("");

  out.push("## Open owner liability");
  out.push("");
  if (data.liability.length === 0) out.push("Nothing open: every private payment is refunded.");
  for (const l of data.liability) {
    out.push(
      `- ${l.source}: ${l.openBase} SEK open over ${l.openCount} expense${l.openCount === 1 ? "" : "s"}`,
    );
  }
  out.push("");

  out.push("## Swiss VAT declaration periods");
  out.push("");
  if (data.vatPeriods.length === 0)
    out.push("No invoice of the period is under a Swiss declaration period.");
  for (const v of data.vatPeriods) {
    out.push(
      `- ${v.declarationPeriod}: ${v.count} invoice${v.count === 1 ? "" : "s"}, net ${v.net} ${v.currency}, VAT ${v.vat} ${v.currency}, total ${v.total} ${v.currency}`,
    );
  }
  out.push("");

  out.push("## Contents");
  out.push("");
  out.push(
    "- `bank-statements/` — the rows of the period per account, as imported, plus their source file and row",
  );
  out.push(
    "- `client-invoices/`, `supplier-invoices/`, `expenses/`, `documents/` — every document under its business key",
  );
  out.push(
    "- `summary.xlsx` — Bank statement · Income · Supplier invoices · Expenses · Settlements · Links · Flags (generated; every status is derived from the links)",
  );
  out.push("");
  return out.join("\n");
}
