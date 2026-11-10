// *When you accept* (F185, the board *Documents*): what one click does with a document still in the inbox — the
// entity it **creates** (its kind, its future key), the bank row it **links** (the best HIGH match of the scorer,
// when one is open), what it **files** (the category, the partner). A read, nothing written: the services the
// click calls are the existing ones — `justifyRow` when a row pays it (one transaction: entity + payment), else the
// supplier invoice's create. Every value comes from a fact (D73, lessons *F124 build*: never list order):
//   kind      the document's type (invoice → supplier invoice, expense → expense), a drop nobody typed by its
//             reading (D78 `readingProposes`)
//   partner   the partner match on the paper's vendor / VAT number (≥ 60 %, the card's *best match*)
//   category  the document's BAS proposal (F126), else the partner's default — an account with a short code
//   group     the paper's date (`proposeGroupForDate`: the covering trip, else the month's group), else a new group
//             for the month (created on the click, as the reading dialog does)
//   key       peeked from the group's series (final at commit — another click may take it first)
// Server-only.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as numbering from "@/modules/numbering";
import * as partners from "@/modules/partners";
import { justifyOptions } from "./justify-options";
import type { JustifyKind } from "./justify-rules";
import { monthOf } from "./justify-rules";
import { documentBasHints } from "./proposals/documents";
import { suggestionsForEntity } from "./suggestions";

type AcceptChain = documents.AcceptChain;

export type { AcceptChain };
export type AcceptMissing = documents.AcceptMissing;

/** The rows `justifyRow` takes: not justified yet (linked, *no proof*), outgoing, on a main account. */
const CLOSED = new Set<string>(["linked", "linked_no_partner", "no_document"]);

function kindOf(prefixType: string, proposes: string): JustifyKind | null {
  if (prefixType === "invoice") return "supplier_invoice";
  if (prefixType === "expense") return "expense";
  if (prefixType === "document")
    return proposes === "expense" || proposes === "supplier_invoice" ? proposes : null;
  return null;
}

/**
 * The chain for one inbox document, or null when it has none: not a financial document still in the inbox, or
 * nothing to make of it yet (no reading, or the reading asks what it is).
 */
export async function documentAcceptChain(
  tx: TransactionClient,
  caller: CallerIdentity,
  documentId: string,
): Promise<ServiceResult<AcceptChain | null>> {
  const [facts] = await documents.inboxFinancialFacts(tx, caller, { ids: [documentId] });
  if (!facts) return { data: null };
  const kind = kindOf(facts.prefixType, facts.proposes);
  if (!kind || !facts.total) return { data: null };

  const options = await justifyOptions(tx, caller);

  // the partner: the match on the paper's vendor facts (the card's best match, F131)
  const matches = await partners.matchPartners(tx, {
    name: facts.vendorName,
    vatNumber: facts.vendorVatNumber,
    ...(kind === "supplier_invoice" ? { type: "vendor" as const } : {}),
  });
  const best = matches[0] && matches[0].percent >= partners.BEST_MATCH_PERCENT ? matches[0] : null;
  const partner = best ? options.partners.find((p) => p.id === best.partnerId) : undefined;

  // the category: the document's proposal (F126), else the partner's default — one the key can carry (an alias)
  const hint = (await documentBasHints(tx, [documentId]))[documentId];
  const byCode = (code: string | null | undefined) =>
    code ? options.categories.find((c) => c.code === code && c.alias) : undefined;
  const category = byCode(hint?.code) ?? byCode(partner?.defaultBasCode);
  const categorySource = category
    ? byCode(hint?.code)
      ? ("proposal" as const)
      : ("partner" as const)
    : null;

  // the group: the paper's date proposes it; none → a new group for the month, numbered by the group series
  const date = facts.date;
  const proposal = date
    ? expenses.proposeGroupForDate(
        date,
        options.groups.map((g) => ({
          id: g.id,
          name: g.description ?? g.label,
          kind: g.kind,
          departure: g.departure,
          return: g.return,
          month: g.month ?? null,
        })),
      )
    : { groupId: null, reason: null };
  const found = proposal.groupId ? options.groups.find((g) => g.id === proposal.groupId) : null;
  let group: AcceptChain["group"] = null;
  if (found)
    group = {
      id: found.id,
      number: found.number,
      name: found.description ?? found.label,
      month: found.month ?? null,
      isNew: false,
    };
  else if (date) {
    const next = await numbering.peekSeries(tx, numbering.EXPENSE_GROUP_SERIES);
    group = {
      id: null,
      number: next.data?.nextValue ?? 1,
      name: monthOf(date),
      month: monthOf(date),
      isNew: true,
    };
  }

  // the key: peeked from the group's series for the category's alias (final at commit)
  let key: string | null = null;
  if (group && category?.alias) {
    const seq = group.isNew
      ? 1
      : ((await numbering.peekSeries(tx, numbering.expenseSeries(group.number, category.alias)))
          .data?.nextValue ?? 1);
    key =
      kind === "supplier_invoice"
        ? numbering.supplierInvoiceRef(group.number, category.alias, seq)
        : numbering.expenseRef(group.number, category.alias, seq);
  }

  // the bank row: the scorer's best HIGH match, when justifyRow can take it
  let bankRow: AcceptChain["bankRow"] = null;
  const suggested = await suggestionsForEntity(tx, { type: "document", id: documentId });
  const top = suggested.data?.suggestions.find(
    (s) => s.candidate.type === "bank_transaction" && s.confidence === "HIGH",
  );
  if (top) {
    const row = await banking.getBankTransaction(tx, top.candidate.id);
    const state = row ? (await banking.transactionStates(tx, [row.id])).get(row.id) : undefined;
    if (
      row &&
      row.accountRole === "main" &&
      Number(row.amount) < 0 &&
      !CLOSED.has(state?.state ?? "")
    )
      bankRow = {
        id: row.id,
        date: row.bookingDate,
        amount: row.amount,
        currency: row.currency,
        score: Math.min(100, Math.round(top.score)),
        label: row.counterpartyKey || row.description,
      };
  }

  const tax = facts.tax && Number(facts.tax) > 0 ? facts.tax : null;
  const net =
    facts.subtotal ??
    (tax ? (Number(facts.total) - Number(tax)).toFixed(2) : Number(facts.total).toFixed(2));
  const chain: AcceptChain = {
    documentId,
    kind,
    key,
    vendor: facts.vendorName,
    group,
    category: category
      ? { code: category.code, label: category.label, source: categorySource }
      : null,
    partner: partner && best ? { id: partner.id, name: partner.name, percent: best.percent } : null,
    bankRow,
    fields: {
      invoiceNumber: facts.invoiceNumber,
      date,
      dueDate: facts.dueDate && date && facts.dueDate >= date ? facts.dueDate : null,
      currency: facts.currency,
      amountTotal: Number(facts.total).toFixed(2),
      vatAmount: tax,
      amountNet: net,
    },
    missing: [],
  };
  chain.missing = documents.acceptMissing(chain);
  return { data: chain };
}
