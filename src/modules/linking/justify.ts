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
} from "./justify-rules";

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
  type NoProofReason,
  proposeKind,
  type Reading,
  type RowForJustify,
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
  })
  .refine((v) => (v.kind === "supplier_invoice" ? !!v.supplier : !!v.expense), {
    message: "The entity's fields are missing",
  });
export type JustifyInput = z.input<typeof justifySchema>;

export const noProofSchema = z.object({
  transactionId: uuid,
  reason: z.enum(NO_PROOF_REASONS as [NoProofReason, ...NoProofReason[]]),
  /** the owner's own category, else the reason's */
  basCode: basCode.nullable().optional(),
});
export type NoProofInput = z.input<typeof noProofSchema>;

export type JustifyResult = {
  entity: { type: JustifyKind; id: string; key: string };
  /** the row as categorised by the click */
  row: { partnerId: string | null; basCode: string | null };
};

// --- the composite ---

/** A refused step names itself in the message (US1 scenario 8): *entity: …*, *payment: …*, *row: …*. */
function step<T>(name: "entity" | "payment" | "row", r: ServiceResult<T>): ServiceResult<T> {
  return r.error ? { error: { ...r.error, message: `${name}: ${r.error.message}` } } : r;
}

/** The row the panel may justify: outgoing, on a main account, with something left to allocate. */
async function openRow(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<{ currency: string; amount: string; bankAccountId: string }>> {
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
  if (state && (state.state === "linked" || state.state === "no_document"))
    return { error: violation("This row is justified already") };
  return { data: { currency: row.currency, amount: row.amount, bankAccountId: row.bankAccountId } };
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
    },
  };
}

/**
 * No proof needed (US3): the flag and the reason's category on the row, by hand. Returns whether a rule could be
 * proposed for the counterparty (no active rule hits it yet) — the panel's toast offers *Create rule from this*.
 */
export async function noProofNeeded(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: NoProofInput,
): Promise<ServiceResult<{ basCode: string | null; proposeRule: boolean }>> {
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
  const code = v.basCode !== undefined ? v.basCode : NO_PROOF_BAS[v.reason];
  const facts = await banking.categorise(tx, caller, audit, v.transactionId, {
    noDocumentNeeded: true,
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
  return { data: { basCode: facts.data.basCode, proposeRule: !hit } };
}
