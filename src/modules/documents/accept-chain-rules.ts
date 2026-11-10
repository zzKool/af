// The accept chain's pure half (F185): what the one click still lacks, the steps it shows and the button's word,
// and the payload it sends to the existing actions — linking's `justifyRow` when a bank row pays it, else the
// supplier invoice's create. No new business rule: the payloads are the actions' own inputs, validated there again.
// Client-safe; the desk shows the chain, linking reads it (`documentAcceptChain`) through this module's index.
import type { Currency } from "@/kernel/nav/constants";

/** what the document becomes — linking's `JustifyKind` */
export type AcceptKind = "supplier_invoice" | "expense";

/** What the chain needs before one click can do it; each names the step that would carry it. */
export type AcceptMissing =
  | "partner"
  | "category"
  | "group"
  | "invoiceNumber"
  | "amount"
  | "date"
  | "currency"
  /** an expense needs the account that paid it: without its bank row, the form asks */
  | "payer";

export type AcceptChain = {
  documentId: string;
  kind: AcceptKind;
  /** the entity's future key (peeked — final at commit); null until a group and a category are known */
  key: string | null;
  vendor: string | null;
  /** the group the paper's date proposes; `id` null = a new group for the month, made on the click */
  group: {
    id: string | null;
    number: number;
    name: string;
    month: string | null;
    isNew: boolean;
  } | null;
  category: { code: string; label: string; source: "proposal" | "partner" | null } | null;
  partner: { id: string; name: string; percent: number } | null;
  /** the best HIGH bank row that can justify it; null = none open */
  bankRow: {
    id: string;
    date: string;
    /** signed, 2 dp */
    amount: string;
    currency: string;
    /** the scorer's score, 0–100 */
    score: number;
    label: string;
  } | null;
  /** the paper's facts as corrected, in the actions' shape (2 dp strings) */
  fields: {
    invoiceNumber: string | null;
    date: string | null;
    dueDate: string | null;
    currency: string | null;
    amountTotal: string | null;
    vatAmount: string | null;
    amountNet: string | null;
  };
  missing: AcceptMissing[];
};

/** What the one click still lacks (the step that shows it asks; the form fills the rest). */
export function acceptMissing(c: Omit<AcceptChain, "missing">): AcceptMissing[] {
  const out: AcceptMissing[] = [];
  const supplier = c.kind === "supplier_invoice";
  if (supplier && !c.partner) out.push("partner");
  if (!c.category) out.push("category");
  if (!c.group) out.push("group");
  if (supplier && !c.fields.invoiceNumber?.trim()) out.push("invoiceNumber");
  if (!(Number(c.fields.amountTotal) > 0)) out.push("amount");
  if (!c.fields.date) out.push("date");
  if (!c.fields.currency) out.push("currency");
  if (!supplier && !c.bankRow) out.push("payer");
  return out;
}

export type ChainStep = "creates" | "links" | "files";

/** The steps the chain shows: *creates* always, *links* when a bank row pays it, *files* when it carries a category
 *  or a partner. */
export function chainSteps(c: Pick<AcceptChain, "bankRow" | "category" | "partner">): ChainStep[] {
  return [
    "creates",
    ...(c.bankRow ? (["links"] as const) : []),
    ...(c.category || c.partner ? (["files"] as const) : []),
  ];
}

/** The primary's word by the number of steps: *Accept all three* · *Accept both* · *Accept*. */
export function acceptLabelKey(steps: number): "three" | "both" | "one" {
  return steps >= 3 ? "three" : steps === 2 ? "both" : "one";
}

/** The supplier invoice's fields as `justifyRow` / `createSupplierInvoice` take them. */
export function supplierPayload(c: AcceptChain, groupId: string) {
  const f = c.fields;
  return {
    groupId,
    partnerId: c.partner?.id ?? "",
    invoiceNumber: (f.invoiceNumber ?? "").trim(),
    invoiceDate: f.date ?? "",
    ...(f.dueDate ? { dueDate: f.dueDate } : {}),
    currency: (f.currency ?? "") as Currency,
    amountNet: f.amountNet ?? f.amountTotal ?? "",
    ...(f.vatAmount ? { vatAmount: f.vatAmount } : {}),
    amountTotal: f.amountTotal ?? "",
    basCode: c.category?.code ?? "",
  };
}

/** The expense's fields as `justifyRow` takes them (the payer is the row's account). */
export function expensePayload(c: AcceptChain, groupId: string) {
  const f = c.fields;
  return {
    groupId,
    date: f.date ?? "",
    description: (c.vendor ?? "").trim() || (c.category?.label ?? ""),
    basCode: c.category?.code ?? "",
    amount: f.amountTotal ?? "",
    currency: (f.currency ?? "") as Currency,
    ...(f.vatAmount ? { vatAmount: f.vatAmount } : {}),
    partnerId: c.partner?.id ?? null,
  };
}
