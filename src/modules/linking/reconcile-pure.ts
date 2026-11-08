// Reconcile's pure part (F139, specs/linking/reconcile.md): the types, the groups, the stage's sure / proposed /
// asked fields, the twins, the bank's FX cost, the default month. Client-safe — the stage recomputes the fields when
// the owner picks another candidate. MUST NOT import from next/* or a server module.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionListRow } from "@/modules/banking/ui";
import type { EntityFacts, Suggestion } from "./types";

const D = Prisma.Decimal;

/** The inbox row as the page receives it (the server's `InboxRow`). */
export type InboxRowShape = RowLike & {
  row: EntityFacts;
  accountLabel: string;
  state: TransactionListRow["state"];
  basCode: string | null;
  basLabel: string | null;
  suggestions: Suggestion[];
  list: TransactionListRow;
};

/** What the pure functions read of an inbox row (`InboxRow` is the server's; this is its shape). */
type RowLike = {
  top: Suggestion | null;
  list: Pick<
    TransactionListRow,
    | "partnerId"
    | "partnerName"
    | "partnerFrom"
    | "basCode"
    | "basLabel"
    | "basFrom"
    | "proposedBasCode"
    | "proposedSource"
    | "proposedConfidence"
  >;
  rememberedPartnerId: string | null;
};

// --- types ---

/** Ready · To check · Needs a document · Who is this? (US1) */
export type ReconcileGroup = "ready" | "check" | "document" | "who";
export const RECONCILE_GROUPS: readonly ReconcileGroup[] = ["ready", "check", "document", "who"];

/**
 * A field of the stage: *sure* (typed on the row, carried by its proof or by the candidate — shown as a fact),
 * *proposed* (the counterparty memory, F98's proposal — prefilled and marked), *ask* (nothing known — asked).
 */
export type StageField = {
  state: "sure" | "proposed" | "ask";
  /** the partner id / the BAS code */
  value: string | null;
  /** the name when the read has it (a candidate's partner); the page resolves the rest from its options */
  label: string | null;
  from: "row" | "proof" | "candidate" | "memory" | "rule" | "partner_default" | "model" | null;
  /** F98's 0–1, for a proposed category */
  confidence: number | null;
};

/** The bank's FX cost on a cross-currency candidate: the original, the ECB rate of its day, what the bank took. */
export type FxView = {
  original: string;
  originalCurrency: string;
  rowCurrency: string;
  /** 1 original = rate × row currency, ECB, 6 dp */
  ecbRate: string;
  rateDate: string;
  ecbAmount: string;
  charged: string;
  /** the bank's rate: charged ÷ original, 6 dp */
  bankRate: string;
  /** charged − ECB amount, in the row's currency */
  cost: string;
  /** cost ÷ ECB amount × 100, 1 dp */
  costPercent: string;
};

export type ReconcileRow = {
  id: string;
  group: ReconcileGroup;
  inbox: InboxRowShape;
  partner: StageField;
  category: StageField;
  /** the other open rows of the month on the same account, day, amount and counterparty */
  twins: string[];
  fx: FxView | null;
};

/** A link made today from a bank row — *Done today* with its *Undo* (US3). */
export type DoneLink = {
  linkId: string;
  bankTransactionId: string;
  rowLabel: string;
  targetLabel: string;
  amount: string | null;
  currency: string | null;
  at: string;
};

export type ReconcileData = {
  month: string;
  previous: string | null;
  next: string | null;
  /** the month's bank rows (the Months panel's counts) */
  progress: { justified: number; toJustify: number };
  rows: ReconcileRow[];
  done: DoneLink[];
};

// --- pure ---

/** The partner the row knows: its own (typed or the proof's), else the best candidate's. */
function knownPartner(
  r: RowLike,
  s: Suggestion | null,
): { id: string; name: string | null } | null {
  if (r.list.partnerId) return { id: r.list.partnerId, name: r.list.partnerName };
  if (s?.candidate.partnerId) return { id: s.candidate.partnerId, name: s.candidate.partnerName };
  return null;
}

/** US1's groups: Ready = a HIGH candidate and a known partner; To check = a candidate, something unsure. */
export function reconcileGroup(r: RowLike): ReconcileGroup {
  const partner = knownPartner(r, r.top) !== null;
  if (r.top) return r.top.confidence === "HIGH" && partner ? "ready" : "check";
  return partner ? "document" : "who";
}

/** The stage's partner and category for a row and the candidate in focus (FR-001). */
export function stageFields(
  r: RowLike,
  s: Suggestion | null,
): { partner: StageField; category: StageField } {
  const none = { label: null, confidence: null };
  let partner: StageField;
  if (r.list.partnerId)
    partner = {
      state: "sure",
      value: r.list.partnerId,
      label: r.list.partnerName,
      from: r.list.partnerFrom === "proof" ? "proof" : "row",
      confidence: null,
    };
  else if (s?.candidate.partnerId)
    partner = {
      state: "sure",
      value: s.candidate.partnerId,
      label: s.candidate.partnerName,
      from: "candidate",
      confidence: null,
    };
  else if (r.rememberedPartnerId)
    partner = { ...none, state: "proposed", value: r.rememberedPartnerId, from: "memory" };
  else partner = { ...none, state: "ask", value: null, from: null };

  let category: StageField;
  if (r.list.basCode)
    category = {
      state: "sure",
      value: r.list.basCode,
      label: r.list.basLabel,
      from: r.list.basFrom === "proof" ? "proof" : "row",
      confidence: null,
    };
  else if (s?.candidate.basCode)
    category = { ...none, state: "sure", value: s.candidate.basCode, from: "candidate" };
  else if (r.list.proposedBasCode)
    category = {
      state: "proposed",
      value: r.list.proposedBasCode,
      label: null,
      from: r.list.proposedSource,
      confidence: r.list.proposedConfidence,
    };
  else category = { ...none, state: "ask", value: null, from: null };
  return { partner, category };
}

/** Twins (duplicate detection): rows on the same account, day, amount and counterparty — each with the others. */
export function twinsOf(
  rows: readonly {
    id: string;
    accountId: string;
    date: string;
    amount: string;
    counterpartyKey: string;
  }[],
): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.accountId}|${r.date}|${new D(r.amount).toFixed(2)}|${r.counterpartyKey}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r.id]);
  }
  const out = new Map<string, string[]>();
  for (const ids of byKey.values())
    if (ids.length > 1)
      for (const id of ids)
        out.set(
          id,
          ids.filter((x) => x !== id),
        );
  return out;
}

/** The bank's FX cost (FR-001): the ECB amount of the original, what the row charged, the difference and its %. */
export function bankFxCost(input: {
  original: string;
  originalCurrency: string;
  charged: string;
  rowCurrency: string;
  ecbRate: string;
  rateDate: string;
}): FxView {
  const original = new D(input.original).abs();
  const charged = new D(input.charged).abs();
  const ecbAmount = original.mul(new D(input.ecbRate)).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const cost = charged.sub(ecbAmount);
  return {
    original: original.toFixed(2),
    originalCurrency: input.originalCurrency,
    rowCurrency: input.rowCurrency,
    ecbRate: new D(input.ecbRate).toFixed(6),
    rateDate: input.rateDate,
    ecbAmount: ecbAmount.toFixed(2),
    charged: charged.toFixed(2),
    bankRate: original.isZero() ? "0.000000" : charged.div(original).toFixed(6),
    cost: cost.toFixed(2),
    costPercent: ecbAmount.isZero() ? "0.0" : cost.div(ecbAmount).mul(100).toFixed(1),
  };
}

/** The month the page opens on: the oldest with a row to justify among the given ones, else this month. */
export function defaultReconcileMonth(
  thisMonth: string,
  months: readonly { month: string; toJustify: number }[],
): string {
  return months.find((m) => m.toJustify > 0)?.month ?? thisMonth;
}
