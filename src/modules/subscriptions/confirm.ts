// The confirm (F94 FR-008, US3, US4): the one owner action that turns a period's offer into an entity — through the
// owning module's services, in one transaction: create (or complete) the expense / supplier invoice, attach the row
// (expenses only — a bill's payment is its own module's flow, US3-6), write `occurrence_of`. Nothing here runs on its
// own: import, OCR and every read leave the periods untouched (D57, SC-002).
import { z } from "zod/v4";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { CURRENCIES } from "@/kernel/nav/constants";
import { isoDate, money, positiveMoney, uuid } from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as linking from "@/modules/linking";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { invalid, notFound, violation } from "./errors";
import { type LoadedSubscription, loadSubscriptions } from "./facts";
import type { Becomes, EntityFact, PeriodView } from "./types";

export const confirmFactsSchema = z.object({
  date: isoDate,
  description: z.string().trim().min(1).max(200),
  amount: positiveMoney,
  currency: z.enum(CURRENCIES),
  vatAmount: money.nullable().optional(),
  /** a bill (supplier invoice) */
  invoiceNumber: z.string().trim().min(1).max(100).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  amountNet: money.nullable().optional(),
});
export type ConfirmFacts = z.infer<typeof confirmFactsSchema>;

export const confirmSchema = z.object({
  subscriptionId: uuid,
  periodDate: isoDate,
  bankTransactionId: uuid.optional(),
  documentId: uuid.optional(),
  /** what the dialog shows, as the owner left it; omitted → the prefill */
  facts: confirmFactsSchema.optional(),
  duplicateAck: z
    .object({ entityIds: z.array(uuid).min(1).max(5), note: z.string().trim().min(1).max(500) })
    .optional(),
});
export type ConfirmInput = z.input<typeof confirmSchema>;

export type ConfirmPrefill = {
  becomes: Becomes;
  /** what the period already has: then the confirm completes it (a receipt, a row) */
  entity: EntityFact | null;
  facts: ConfirmFacts | null;
  /** why there is nothing to create yet (Q1 A: a foreign-currency charge waits for its receipt; a bill waits for the bill) */
  waitingFor: "receipt" | "bill" | null;
  duplicates: expenses.DuplicateMatch[];
  /** the receipt's OCR total differs from the attached expense beyond the tolerance (US4-5) — a warning */
  amountWarning: boolean;
};

export type ConfirmResult = {
  entity: { type: Becomes; id: string; key: string };
  created: boolean;
  attachedRow: boolean;
  attachedDocument: boolean;
};

type Context = {
  sub: LoadedSubscription;
  period: PeriodView;
  entity: EntityFact | null;
  row: banking.WindowRow | null;
  doc: documents.InboxDocumentFacts | null;
};

async function context(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: {
    subscriptionId: string;
    periodDate: string;
    bankTransactionId?: string;
    documentId?: string;
  },
  today: string,
): Promise<ServiceResult<Context>> {
  const [sub] = await loadSubscriptions(tx, caller, today, [input.subscriptionId]);
  if (!sub) return { error: notFound("Subscription", input.subscriptionId) };
  const period = sub.periods.find((p) => p.date === input.periodDate);
  if (!period)
    return { error: violation(`${sub.subscription.name} expects nothing on ${input.periodDate}`) };
  let row: banking.WindowRow | null = null;
  if (input.bankTransactionId) {
    if (sub.subscription.becomes !== "expense")
      return { error: violation("A supplier invoice's payment is linked from its own panel") };
    if (!sub.bankAccountId) return { error: violation("A private payer has no bank row") };
    const rows = await banking.outgoingRowsInWindow(tx, {
      bankAccountIds: [sub.bankAccountId],
      ...period.rowWindow,
    });
    row = rows.find((r) => r.id === input.bankTransactionId) ?? null;
    if (!row)
      return {
        error: violation(
          "That bank row is not an open outgoing row of the payer's account in this period",
        ),
      };
  }
  let doc: documents.InboxDocumentFacts | null = null;
  if (input.documentId) {
    // any inbox document may be assigned (US4, *Assign a receipt…*); its facts are read where it is dated
    const [found] = await documents.inboxFinancialFacts(tx, caller, { ids: [input.documentId] });
    doc = found ?? null;
    if (!doc) return { error: violation("That document is not waiting in the inbox") };
  }
  return { data: { sub, period, entity: period.entities[0] ?? null, row, doc } };
}

function prefillFacts(c: Context): {
  facts: ConfirmFacts | null;
  waitingFor: ConfirmPrefill["waitingFor"];
} {
  const s = c.sub.subscription;
  const description = s.name;
  if (c.doc && c.doc.total && c.doc.currency) {
    return {
      facts: {
        date: c.doc.date ?? c.period.date,
        description,
        amount: c.doc.total,
        currency: c.doc.currency as ConfirmFacts["currency"],
        vatAmount: c.doc.tax,
        invoiceNumber: c.doc.invoiceNumber,
        dueDate: c.doc.dueDate,
        amountNet: c.doc.subtotal,
      },
      waitingFor: null,
    };
  }
  if (s.becomes === "supplier_invoice") return { facts: null, waitingFor: "bill" };
  if (c.row) {
    // Q1 A: a charge in another currency than the subscription's waits for the receipt — the receipt's amount is the
    // expense's (D26), never an expected one
    if (c.period.price && c.row.currency !== c.period.price.currency && !c.doc)
      return { facts: null, waitingFor: "receipt" };
    return {
      facts: {
        date: c.row.bookingDate,
        description,
        amount: c.row.amount,
        currency: c.row.currency as ConfirmFacts["currency"],
      },
      waitingFor: null,
    };
  }
  if (c.doc) {
    // a document whose amount OCR did not read: the dialog asks for it, pre-filled with the expectation
    return {
      facts: c.period.price
        ? {
            date: c.doc.date ?? c.period.date,
            description,
            amount: c.period.price.amount,
            currency: c.period.price.currency as ConfirmFacts["currency"],
            invoiceNumber: c.doc.invoiceNumber,
          }
        : null,
      waitingFor: null,
    };
  }
  return { facts: null, waitingFor: "receipt" };
}

/** What the confirm dialog shows (and *Confirm all exact* uses): the merged facts, the duplicates, the warnings. */
export async function confirmPrefill(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: {
    subscriptionId: string;
    periodDate: string;
    bankTransactionId?: string;
    documentId?: string;
  },
  today: string,
): Promise<ServiceResult<ConfirmPrefill>> {
  const c = await context(tx, caller, input, today);
  if (c.error) return c;
  const { entity } = c.data;
  if (entity) {
    const warn =
      !!c.data.doc?.total &&
      c.data.doc.currency === entity.currency &&
      Math.abs(Number(c.data.doc.total) - Number(entity.amount)) / Number(entity.amount) >
        Number(c.data.sub.subscription.tolerancePct) / 100;
    return {
      data: {
        becomes: c.data.sub.subscription.becomes,
        entity,
        facts: null,
        waitingFor: null,
        duplicates: [],
        amountWarning: warn,
      },
    };
  }
  const { facts, waitingFor } = prefillFacts(c.data);
  const duplicates =
    facts && c.data.sub.subscription.becomes === "expense"
      ? await expenses.findExpenseDuplicates(tx, {
          documentId: input.documentId,
          merchant: facts.description,
          amount: facts.amount,
          currency: facts.currency,
          date: facts.date,
        })
      : [];
  return {
    data: {
      becomes: c.data.sub.subscription.becomes,
      entity: null,
      facts,
      waitingFor,
      duplicates,
      amountWarning: false,
    },
  };
}

/** FR-008: one transaction — any refusal of the owning module refuses the whole confirm. */
export async function confirm(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: ConfirmInput,
  today: string,
): Promise<ServiceResult<ConfirmResult>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  if (!v.bankTransactionId && !v.documentId)
    return { error: violation("Pick the bank row or the receipt this period is confirmed with") };
  const c = await context(tx, caller, v, today);
  if (c.error) return c;
  const { sub, entity, row, doc } = c.data;
  const s = sub.subscription;

  // a period that already has its entity: complete it (US4-4 — the receipt after the charge; the charge after the receipt)
  if (entity) {
    let attachedDocument = false;
    let attachedRow = false;
    if (doc && !entity.hasDocument) {
      if (entity.type !== "expense")
        return {
          error: violation(
            `${entity.key} is a supplier invoice — attach its document from its own panel`,
          ),
        };
      const r = await expenses.attachDocument(tx, caller, audit, {
        expenseId: entity.id,
        documentId: doc.id,
      });
      if (r.error) return { error: r.error };
      attachedDocument = true;
    }
    if (row && entity.needsPayment && !entity.paid) {
      const r = await expenses.payExpense(tx, caller, audit, {
        expenseId: entity.id,
        bankTransactionId: row.id,
      });
      if (r.error) {
        if (attachedDocument) throw new RollbackError(r.error);
        return { error: r.error };
      }
      attachedRow = true;
    }
    if (!attachedDocument && !attachedRow)
      return { error: violation(`${entity.key} already has what was offered`) };
    return {
      data: {
        entity: { type: entity.type, id: entity.id, key: entity.key },
        created: false,
        attachedRow,
        attachedDocument,
      },
    };
  }

  const pre = prefillFacts(c.data);
  const facts = v.facts ?? pre.facts;
  if (!facts) {
    return {
      error: violation(
        pre.waitingFor === "bill"
          ? "A supplier invoice is created from its bill — waiting for the bill"
          : "Waiting for the receipt: a charge in another currency takes the receipt's amount",
        { waitingFor: pre.waitingFor ?? "receipt" },
      ),
    };
  }

  let created: { type: Becomes; id: string; key: string };
  if (s.becomes === "expense") {
    // Q1 A: a charge in another currency than the subscription's waits for its receipt — even with typed facts
    if (row && !doc && c.data.period.price && row.currency !== c.data.period.price.currency)
      return { error: violation("Waiting for the receipt", { waitingFor: "receipt" }) };
    if (!v.duplicateAck) {
      const dups = await expenses.findExpenseDuplicates(tx, {
        documentId: doc?.id,
        merchant: facts.description,
        amount: facts.amount,
        currency: facts.currency,
        date: facts.date,
      });
      const high = dups.filter((d) => d.confidence === "high");
      if (high.length > 0)
        return {
          error: violation(`${high[0]?.entityKey} looks like the same expense`, {
            duplicates: high.map((d) => d.entityId).join(","),
          }),
        };
    }
    const e = await expenses.createExpense(tx, caller, audit, {
      groupId: s.groupId,
      date: facts.date,
      description: facts.description,
      basCode: s.basCode,
      amount: facts.amount,
      currency: facts.currency,
      vatAmount: facts.vatAmount ?? null,
      vatRegistrationId: s.vatRegistrationId,
      paidFromAccountId: s.paidFromAccountId,
      partnerId: s.partnerId,
      documentId: doc?.id,
      documentMissing: false,
      duplicateAck: v.duplicateAck,
    });
    if (e.error) return { error: e.error };
    created = { type: "expense", id: e.data.id, key: e.data.key };
    if (row) {
      const a = await expenses.payExpense(tx, caller, audit, {
        expenseId: e.data.id,
        bankTransactionId: row.id,
      });
      if (a.error) throw new RollbackError(a.error);
    }
  } else {
    if (!doc)
      return {
        error: violation("A supplier invoice is created from its bill — waiting for the bill"),
      };
    if (!facts.invoiceNumber)
      return { error: invalid("The supplier's invoice number is required") };
    const vat = facts.vatAmount ?? "0.00";
    const net = facts.amountNet ?? (Number(facts.amount) - Number(vat)).toFixed(2);
    const si = await supplierInvoices.createSupplierInvoice(tx, caller, audit, {
      groupId: s.groupId,
      partnerId: s.partnerId,
      invoiceNumber: facts.invoiceNumber,
      invoiceDate: facts.date,
      dueDate: facts.dueDate ?? undefined,
      currency: facts.currency,
      amountNet: net,
      vatAmount: vat,
      amountTotal: facts.amount,
      basCode: s.basCode,
      vatRegistrationId: s.vatRegistrationId,
      documentId: doc.id,
      duplicateAck: v.duplicateAck,
    });
    if (si.error) return { error: si.error };
    created = { type: "supplier_invoice", id: si.data.id, key: si.data.key };
  }

  const link = await linking.createLink(tx, caller, audit, {
    from: { type: created.type, id: created.id },
    to: { type: "subscription", id: s.id },
    kind: "occurrence_of",
  });
  if (link.error) throw new RollbackError(link.error);
  return {
    data: { entity: created, created: true, attachedRow: !!row, attachedDocument: !!doc },
  };
}

export type ConfirmAllReport = {
  confirmed: { subscriptionId: string; periodDate: string; key: string }[];
  skipped: { subscriptionId: string; periodDate: string; reason: string }[];
};

/**
 * *Confirm all exact* (US3-8): every expense period with no entity whose only offer is one exact row (same currency,
 * within 0.5 %, found by the text, offered to no other period) — confirmed one by one; the rest are left for the
 * owner. A period the owning module refuses (a duplicate …) is reported, never forced.
 */
export async function confirmAllExact(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  today: string,
): Promise<ServiceResult<ConfirmAllReport>> {
  const report: ConfirmAllReport = { confirmed: [], skipped: [] };
  const loaded = await loadSubscriptions(tx, caller, today);
  for (const s of loaded) {
    if (s.subscription.becomes !== "expense") continue;
    for (const p of s.periods) {
      if (p.entities.length > 0 || p.rows.length === 0) continue;
      const only = p.rows.length === 1 ? p.rows[0] : undefined;
      const ref = { subscriptionId: s.subscription.id, periodDate: p.date };
      if (!only || !only.exact || only.ambiguous) {
        report.skipped.push({ ...ref, reason: only ? "not_exact" : "ambiguous" });
        continue;
      }
      const doc =
        p.documents.length === 1 && !p.documents[0]?.ambiguous ? p.documents[0] : undefined;
      const r = await confirm(
        tx,
        caller,
        audit,
        {
          ...ref,
          bankTransactionId: only.rowId,
          documentId: doc?.certain ? doc.documentId : undefined,
        },
        today,
      );
      if (r.error) report.skipped.push({ ...ref, reason: r.error.message });
      else report.confirmed.push({ ...ref, key: r.data.entity.key });
    }
  }
  return { data: report };
}

export type PeriodCandidates = {
  rows: banking.WindowRow[];
  documents: documents.InboxDocumentFacts[];
};

/**
 * *Assign a row… / Assign a receipt…* (FR-009): every open outgoing row of the payer's account in the period's row
 * window, whatever the amount or text (expense periods only), and every inbox document dated within a month of the
 * expected date, whatever the vendor — the owner picks; the confirm then runs as for a match.
 */
export async function periodCandidates(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: { subscriptionId: string; periodDate: string },
  today: string,
): Promise<ServiceResult<PeriodCandidates>> {
  const [sub] = await loadSubscriptions(tx, caller, today, [input.subscriptionId]);
  if (!sub) return { error: notFound("Subscription", input.subscriptionId) };
  const period = sub.periods.find((p) => p.date === input.periodDate);
  if (!period)
    return { error: violation(`${sub.subscription.name} expects nothing on ${input.periodDate}`) };
  const rows =
    sub.subscription.becomes === "expense" && sub.bankAccountId
      ? await banking.outgoingRowsInWindow(tx, {
          bankAccountIds: [sub.bankAccountId],
          ...period.rowWindow,
        })
      : [];
  const docs = await documents.inboxFinancialFacts(tx, caller, {
    from: addDays(period.date, -31),
    to: addDays(period.date, 31),
  });
  return { data: { rows, documents: docs } };
}
