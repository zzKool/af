// Justify from the bank row (F97, specs/justify/spec.md US1, US3): the row is the fact, the document its evidence.
// The pure part reads a row and an OCR reading into the compare card (amount equal / off / another currency, the
// days between, the kind the facts propose); the service is one transaction around the owning modules' services —
// the entity (`supplierInvoices.createSupplierInvoice` / `expenses.createExpense`, with the document → the
// `created_from` link and the key), its payment (`recordPayment` / `attachPayment` / `attachBankTransaction`: the
// `justifies` link with the allocation, D26 / D37) and the row's facts (`banking.categorise` by hand: the owner's
// click is the categorisation). Nothing new is stored: no table, no link kind, no status (SC-005).
// MUST NOT import from next/* or src/components/*. Load-time safe: the schema below names its own fields (the
// modules' schemas are not imported — expenses ↔ supplier-invoices ↔ linking meet through the registry at load).
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { CURRENCIES } from "@/kernel/nav/constants";
import { basCode, isoDate, money, positiveMoney, uuid } from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import * as expenses from "@/modules/expenses";
import * as supplierInvoices from "@/modules/supplier-invoices";
import {
  type JustifyKind,
  NO_PROOF_BAS,
  NO_PROOF_REASONS,
  type NoProofReason,
  proposeVendorRule,
  type VendorRuleDraft,
} from "./justify-rules";
import { WARNING_CODES, type WarningCode } from "./types";

const D = Prisma.Decimal;

const violation = (message: string, details?: Record<string, string | number>): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});
const invalid = (message: string): AppError => ({
  code: "VALIDATION_ERROR",
  message,
  retryable: false,
});

export {
  type CompareCard,
  compareRowToReading,
  isCardPurchase,
  type JustifyKind,
  monthOf,
  NO_PROOF_BAS,
  NO_PROOF_REASONS,
  NO_PROOF_REASONS_INCOMING,
  type NoProofReason,
  type ProposedPartner,
  proposedPartnerRole,
  proposeKind,
  proposeVendorRule,
  type Reading,
  type RowForJustify,
  type VendorRuleDraft,
} from "./justify-rules";

// --- the boundary ---

const signed = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals");

/** The fields the card sends for a supplier invoice — what `createSupplierInvoice` needs; it re-validates. */
export const justifySupplierSchema = z.object({
  groupId: uuid,
  partnerId: uuid,
  invoiceNumber: z.string().trim().min(1, "The supplier's invoice number is required").max(100),
  invoiceDate: isoDate,
  dueDate: isoDate.optional(),
  currency: z.enum(CURRENCIES),
  amountNet: money,
  vatAmount: money.optional(),
  amountTotal: positiveMoney,
  basCode,
  note: z.string().trim().max(2000).nullable().optional(),
});

/** The fields the card sends for an expense — what `createExpense` needs; it re-validates. */
export const justifyExpenseSchema = z.object({
  groupId: uuid,
  date: isoDate,
  description: z.string().trim().min(1, "Description is required").max(200),
  basCode,
  amount: positiveMoney,
  currency: z.enum(CURRENCIES),
  vatAmount: signed.nullable().optional(),
  partnerId: uuid.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const justifySchema = z
  .object({
    transactionId: uuid,
    /** the uploaded proof; omitted = the receipt is lost (`document_missing`) */
    documentId: uuid.optional(),
    kind: z.enum(["supplier_invoice", "expense"]),
    supplier: justifySupplierSchema.optional(),
    expense: justifyExpenseSchema.optional(),
    /** the consistency checks the owner confirmed over (F130, `checkProof`) — written on the link's audit row */
    confirmedWarnings: z
      .array(z.enum(WARNING_CODES as [WarningCode, ...WarningCode[]]))
      .max(WARNING_CODES.length)
      .optional(),
  })
  .refine((v) => (v.kind === "supplier_invoice" ? !!v.supplier : !!v.expense), {
    message: "The entity's fields are missing",
  });
export type JustifyInput = z.input<typeof justifySchema>;

export const PARTNER_REQUIRED =
  "A partner is required — the statement is the proof, the partner says of what";

export const noProofSchema = z.object({
  transactionId: uuid,
  reason: z.enum(NO_PROOF_REASONS as [NoProofReason, ...NoProofReason[]]),
  /** the owner's own category, else the reason's */
  basCode: basCode.nullable().optional(),
  /** the partner the statement names (F129, D73 (b)): the reason proposes one, the owner confirms or picks — required */
  partnerId: z.string({ error: PARTNER_REQUIRED }).uuid(),
});
export type NoProofInput = z.input<typeof noProofSchema>;

export type JustifyResult = {
  entity: { type: JustifyKind; id: string; key: string };
  /** the row as categorised by the click */
  row: { partnerId: string | null; basCode: string | null };
  /**
   * D74 (F129 FR-008): the rule to propose — the counterparty key → the proof's partner — when no active rule names
   * that partner for the key yet; null when one does, or when the entity has no partner
   */
  proposeRule: VendorRuleDraft | null;
};

// --- the composite ---

/** A refused step names itself in the message (US1 scenario 8): *entity: …*, *payment: …*, *row: …*. */
function step<T>(name: "entity" | "payment" | "row", r: ServiceResult<T>): ServiceResult<T> {
  return r.error ? { error: { ...r.error, message: `${name}: ${r.error.message}` } } : r;
}

/**
 * The warnings the owner confirmed over (F130, review 2026-10-31 §4), on the `justifies` link's own audit trail —
 * he saw them, the trail says so. The owning module wrote the link's `create` row (`recordPayment` / `payExpense`);
 * this is a second row on the same entity, in the same transaction. No table, no column; the History's reader
 * ignores a link row that is not a `create` (`banking/history.ts`).
 */
async function auditConfirmedWarnings(
  audit: AuditLogger,
  linkId: string,
  codes: readonly WarningCode[] | undefined,
): Promise<void> {
  const confirmed = [...new Set(codes ?? [])];
  if (confirmed.length === 0) return;
  await audit.log({
    action: "update",
    entityType: "link",
    entityId: linkId,
    newData: { confirmedWarnings: confirmed },
  });
}

/** The states a proof may still be made for: linked (with or without a partner) and *no proof* with one are not. */
const CLOSED_FOR_PROOF: ReadonlySet<banking.TransactionState> = new Set<banking.TransactionState>([
  "linked",
  "linked_no_partner",
  "no_document",
]);
/** The states *no proof needed* is refused on: the row is linked — the proof exists; remove the link first. */
const LINKED: ReadonlySet<banking.TransactionState> = new Set<banking.TransactionState>([
  "linked",
  "linked_no_partner",
]);

/** The row the panel may justify: outgoing, on a main account, with something left to allocate. */
async function openRow(
  tx: TransactionClient,
  id: string,
): Promise<
  ServiceResult<{
    currency: string;
    amount: string;
    bankAccountId: string;
    counterpartyKey: string;
  }>
> {
  const row = await banking.getBankTransaction(tx, id);
  if (!row)
    return {
      error: { code: "NOT_FOUND", message: `Bank transaction not found: ${id}`, retryable: false },
    };
  if (row.accountRole !== "main")
    return {
      error: violation(
        `${row.accountLabel} is a ${row.accountRole} account — its statement is the proof (D13)`,
      ),
    };
  if (new D(row.amount).gte(0))
    return {
      error: violation(
        "An incoming row is justified by the invoice it pays — pick it under Suggestions",
      ),
    };
  const state = (await banking.transactionStates(tx, [id])).get(id);
  if (state && CLOSED_FOR_PROOF.has(state.state))
    return { error: violation("This row is justified already") };
  return {
    data: {
      currency: row.currency,
      amount: row.amount,
      bankAccountId: row.bankAccountId,
      counterpartyKey: row.counterpartyKey,
    },
  };
}

/**
 * D74: after the proof is linked, the rule to propose for the counterparty key — the proof's partner, the category
 * the owner picked — unless an active rule names that partner for the key already (`rulesForKey`), or the entity
 * has no partner. The panel's toast offers it; `createRuleFromTransaction` writes it on a click.
 */
async function vendorRuleProposal(
  tx: TransactionClient,
  key: string,
  partnerId: string | null | undefined,
  basCode: string | null,
): Promise<VendorRuleDraft | null> {
  if (!partnerId) return null;
  const rules = await banking.rulesForKey(tx, key);
  if (rules.some((r) => r.partnerId === partnerId)) return null;
  return proposeVendorRule(key, partnerId, basCode);
}

/**
 * One click, one transaction (US1, US3 *receipt lost*): the entity from the card's fields, its payment by the
 * row, the row's partner and category. A returned error rolls everything back (F111); the uploaded document is
 * its own earlier transaction and survives.
 */
export async function justifyRow(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: JustifyInput,
): Promise<ServiceResult<JustifyResult>> {
  const parsed = justifySchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const row = await openRow(tx, v.transactionId);
  if (row.error) return { error: row.error };

  if (v.kind === "supplier_invoice") {
    const s = v.supplier as z.output<typeof justifySupplierSchema>;
    const created = step(
      "entity",
      await supplierInvoices.createSupplierInvoice(tx, caller, audit, {
        ...s,
        ...(v.documentId ? { documentId: v.documentId } : { documentMissing: true }),
      }),
    );
    if (created.error) return { error: created.error };
    const paid = step(
      "payment",
      await supplierInvoices.recordPayment(tx, caller, audit, {
        invoiceId: created.data.id,
        bankTransactionId: v.transactionId,
      }),
    );
    if (paid.error) return { error: paid.error };
    await auditConfirmedWarnings(audit, paid.data.linkId, v.confirmedWarnings);
    const facts = step(
      "row",
      await banking.categorise(tx, caller, audit, v.transactionId, {
        partnerId: s.partnerId,
        basCode: s.basCode,
      }),
    );
    if (facts.error) return { error: facts.error };
    return {
      data: {
        entity: { type: "supplier_invoice", id: created.data.id, key: created.data.key },
        row: { partnerId: facts.data.partnerId, basCode: facts.data.basCode },
        proposeRule: await vendorRuleProposal(
          tx,
          row.data.counterpartyKey,
          s.partnerId,
          facts.data.basCode,
        ),
      },
    };
  }

  const e = v.expense as z.output<typeof justifyExpenseSchema>;
  // the payer is the row's account — the row pays it (F114 FR-008)
  const created = step(
    "entity",
    await expenses.createExpense(tx, caller, audit, {
      ...e,
      paidFromAccountId: row.data.bankAccountId,
      ...(v.documentId ? { documentId: v.documentId } : { documentMissing: true }),
    }),
  );
  if (created.error) return { error: created.error };
  const paid = step(
    "payment",
    await expenses.payExpense(tx, caller, audit, {
      expenseId: created.data.id,
      bankTransactionId: v.transactionId,
    }),
  );
  if (paid.error) return { error: paid.error };
  await auditConfirmedWarnings(audit, paid.data.linkId, v.confirmedWarnings);
  const facts = step(
    "row",
    await banking.categorise(tx, caller, audit, v.transactionId, {
      partnerId: e.partnerId ?? null,
      basCode: e.basCode,
    }),
  );
  if (facts.error) return { error: facts.error };
  return {
    data: {
      entity: { type: "expense", id: created.data.id, key: created.data.key },
      row: { partnerId: facts.data.partnerId, basCode: facts.data.basCode },
      proposeRule: await vendorRuleProposal(
        tx,
        row.data.counterpartyKey,
        e.partnerId,
        facts.data.basCode,
      ),
    },
  };
}

/**
 * No proof needed (US3; F129 US3): the flag, the reason's category and the partner on the row, by hand — there is
 * no proof to derive the partner from, so it is typed here, never without one (D73 (b)). Refused on a linked row
 * (the proof exists — remove the link first); a *no proof · no partner* row takes it again. Returns whether a rule
 * could be proposed for the counterparty (no active rule hits it yet) — the panel's toast offers *Create rule from
 * this*; the learned rule carries the partner.
 */
export async function noProofNeeded(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: NoProofInput,
): Promise<
  ServiceResult<{ basCode: string | null; partnerId: string | null; proposeRule: boolean }>
> {
  const parsed = noProofSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const row = await banking.getBankTransaction(tx, v.transactionId);
  if (!row)
    return {
      error: {
        code: "NOT_FOUND",
        message: `Bank transaction not found: ${v.transactionId}`,
        retryable: false,
      },
    };
  const state = (await banking.transactionStates(tx, [v.transactionId])).get(v.transactionId);
  if (state && LINKED.has(state.state))
    return { error: violation("This row is linked — remove the link first") };
  const code = v.basCode !== undefined ? v.basCode : NO_PROOF_BAS[v.reason];
  const facts = await banking.categorise(tx, caller, audit, v.transactionId, {
    noDocumentNeeded: true,
    partnerId: v.partnerId,
    ...(code !== null ? { basCode: code } : {}),
  });
  if (facts.error) return { error: facts.error };
  const rules = await banking.listRules(tx);
  const text = {
    counterpartyKey: row.counterpartyKey,
    name: row.name,
    additionalDetails: row.additionalDetails,
    message: row.message,
    sender: row.sender,
    recipient: row.recipient,
  };
  const hit = banking.firstHit(banking.orderRules(rules), text);
  return {
    data: { basCode: facts.data.basCode, partnerId: facts.data.partnerId, proposeRule: !hit },
  };
}
