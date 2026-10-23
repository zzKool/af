"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { enqueue } from "@/kernel/jobs/queue";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { uuid } from "@/kernel/validation/scalars";
import { findExpenseDuplicates } from "@/modules/expenses/duplicates";
import * as expenseService from "@/modules/expenses/expenses";
import * as groups from "@/modules/expenses/groups";
import { renderStatementJob } from "@/modules/expenses/jobs/render-statement";
import { vendorOptions } from "@/modules/expenses/page-data";
import * as paymentSources from "@/modules/expenses/payment-sources";
import {
  distinctExpenseValues,
  EXPENSE_COLUMN_KEYS,
  type ExpenseColumn,
  expenseDateHierarchy,
  getExpenseDetail,
  getGroupDetail,
  getSettlement,
  ledgerSnapshot,
  listExpenses,
  listGroups,
  listSettlements,
  openPrivateExpenses,
  settleableTransactions,
  toExpenseDetailView,
} from "@/modules/expenses/queries";
import * as settlements from "@/modules/expenses/settlements";

const columnSchema = z.enum(EXPENSE_COLUMN_KEYS as [ExpenseColumn, ...ExpenseColumn[]]);
const forbidden = {
  error: { code: "FORBIDDEN" as const, message: "Not allowed to read expenses", retryable: false },
};
const listOptions = z.object({ query: listQuerySchema, groupId: uuid.optional() });

// --- reads (the accountant may read) ---

export const listExpensesAction = authedAction
  .schema(listOptions)
  .metadata({ name: "listExpenses" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return {
      data: await listExpenses(ctx.tx, parsedInput.query, { groupId: parsedInput.groupId }),
    };
  });

export const distinctExpensesAction = authedAction
  .schema(listOptions.extend({ column: columnSchema }))
  .metadata({ name: "distinctExpenses" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return {
      data: await distinctExpenseValues(ctx.tx, parsedInput.column, parsedInput.query, {
        groupId: parsedInput.groupId,
      }),
    };
  });

export const expenseDateHierarchyAction = authedAction
  .schema(listOptions.extend({ column: columnSchema }))
  .metadata({ name: "expenseDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return {
      data: await expenseDateHierarchy(ctx.tx, parsedInput.column, parsedInput.query, {
        groupId: parsedInput.groupId,
      }),
    };
  });

export const getExpenseAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getExpense" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    const r = await getExpenseDetail(ctx.tx, parsedInput.id);
    return r.error ? { error: r.error } : { data: toExpenseDetailView(r.data) };
  });

export const listExpenseGroupsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "listExpenseGroups" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return { data: await listGroups(ctx.tx) };
  });

export const getExpenseGroupAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getExpenseGroup" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return getGroupDetail(ctx.tx, parsedInput.id);
  });

export const listPaymentSourcesAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "listPaymentSources" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return { data: await paymentSources.listPaymentSources(ctx.tx) };
  });

export const ledgerSnapshotAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "expenseLedger" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return { data: await ledgerSnapshot(ctx.tx) };
  });

export const listSettlementsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "listSettlements" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "settlement")) return forbidden;
    return { data: await listSettlements(ctx.tx) };
  });

export const getSettlementAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getSettlement" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "settlement")) return forbidden;
    return getSettlement(ctx.tx, parsedInput.id);
  });

export const openPrivateExpensesAction = authedAction
  .schema(z.object({ paymentSourceId: uuid.optional() }))
  .metadata({ name: "openPrivateExpenses" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "expense")) return forbidden;
    return { data: await openPrivateExpenses(ctx.tx, parsedInput.paymentSourceId) };
  });

export const settleableTransactionsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "settleableTransactions" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "settlement")) return forbidden;
    return { data: await settleableTransactions(ctx.tx) };
  });

export const proposeSettlementAction = authedAction
  .schema(settlements.proposeSchema)
  .metadata({ name: "proposeSettlement" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "settlement")) return forbidden;
    return settlements.proposeSettlement(ctx.tx, parsedInput);
  });

/** The entity duplicate check before "Make it an expense" (specs/documents US3): owner only, read-only. */
/** The partner picker's vendors (F87) — loaded by the picker, since the dialog opens from four pages. */
export const expenseVendorsAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "expenseVendors" })
  .action(async ({ ctx }) => ({ data: await vendorOptions(ctx.tx) }));

export const checkExpenseDuplicatesAction = ownerAction
  .schema(
    z.object({
      documentId: uuid.optional(),
      merchant: z.string().max(200).nullable().optional(),
      amount: z.string().max(20).nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
    }),
  )
  .metadata({ name: "checkExpenseDuplicates" })
  .action(async ({ ctx, parsedInput }) => ({
    data: await findExpenseDuplicates(ctx.tx, parsedInput),
  }));

// --- writes (owner only) ---

export const createExpenseGroupAction = ownerAction
  .schema(groups.groupInputSchema)
  .metadata({ name: "createExpenseGroup" })
  .action(async ({ ctx, parsedInput }) =>
    groups.createGroup(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const updateExpenseGroupAction = ownerAction
  .schema(z.object({ id: uuid, data: groups.updateGroupSchema }))
  .metadata({ name: "updateExpenseGroup" })
  .action(async ({ ctx, parsedInput }) =>
    groups.updateGroup(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id, parsedInput.data),
  );

export const deleteExpenseGroupAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteExpenseGroup" })
  .action(async ({ ctx, parsedInput }) =>
    groups.deleteGroup(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

/** The four sources on first use (FR-002), then the list. */
export const ensurePaymentSourcesAction = ownerAction
  .schema(z.object({}))
  .metadata({ name: "ensurePaymentSources" })
  .action(async ({ ctx }) => ({
    data: await paymentSources.ensureDefaultSources(ctx.tx, ctx.callerIdentity, ctx.audit),
  }));

export const createPaymentSourceAction = ownerAction
  .schema(paymentSources.paymentSourceInputSchema)
  .metadata({ name: "createPaymentSource" })
  .action(async ({ ctx, parsedInput }) =>
    paymentSources.createPaymentSource(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const setPaymentSourceActiveAction = ownerAction
  .schema(z.object({ id: uuid, isActive: z.boolean() }))
  .metadata({ name: "setPaymentSourceActive" })
  .action(async ({ ctx, parsedInput }) =>
    paymentSources.setPaymentSourceActive(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
      parsedInput.isActive,
    ),
  );

export const createExpenseAction = ownerAction
  .schema(expenseService.expenseInputSchema)
  .metadata({ name: "createExpense" })
  .action(async ({ ctx, parsedInput }) =>
    expenseService.createExpense(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const updateExpenseAction = ownerAction
  .schema(z.object({ id: uuid, data: expenseService.updateExpenseSchema }))
  .metadata({ name: "updateExpense" })
  .action(async ({ ctx, parsedInput }) =>
    expenseService.updateExpense(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.id,
      parsedInput.data,
    ),
  );

export const deleteExpenseAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteExpense" })
  .action(async ({ ctx, parsedInput }) =>
    expenseService.deleteExpense(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );

export const attachBankTransactionAction = ownerAction
  .schema(expenseService.attachSchema)
  .metadata({ name: "attachExpenseBankTransaction" })
  .action(async ({ ctx, parsedInput }) =>
    expenseService.attachBankTransaction(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput),
  );

export const detachBankTransactionAction = ownerAction
  .schema(z.object({ expenseId: uuid }))
  .metadata({ name: "detachExpenseBankTransaction" })
  .action(async ({ ctx, parsedInput }) =>
    expenseService.detachBankTransaction(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput.expenseId,
    ),
  );

/** Confirm: the settlement, its lines, the `settles` link; the statement job is enqueued once committed. */
export const confirmSettlementAction = ownerAction
  .schema(settlements.confirmSchema)
  .metadata({ name: "confirmSettlement" })
  .action(async ({ ctx, parsedInput }) => {
    const result = await settlements.confirmSettlement(
      ctx.tx,
      ctx.callerIdentity,
      ctx.audit,
      parsedInput,
    );
    if (result.data) {
      const { tenantId, userId } = ctx.callerIdentity;
      const settlementId = result.data.id;
      ctx.onCommit(async () => {
        await enqueue(
          renderStatementJob,
          { tenantId, userId, settlementId },
          { singletonKey: settlementId },
        );
      });
    }
    return result;
  });

export const cancelSettlementAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "cancelSettlement" })
  .action(async ({ ctx, parsedInput }) =>
    settlements.cancelSettlement(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id),
  );
