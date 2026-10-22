"use server";

import { z } from "zod/v4";
import { zfd } from "zod-form-data";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { createStorageService } from "@/kernel/storage/storage";
import { uuid } from "@/kernel/validation/scalars";
import { detectAccountFromFilename, pickAccount } from "@/modules/banking/account-detect";
import { deleteImport, importCsv } from "@/modules/banking/import";
import {
  accountBalances,
  distinctTransactionValues,
  getTransaction,
  listImports,
  listRulesWithLabels,
  listTransactions,
  TRANSACTION_COLUMN_KEYS,
  type TransactionColumn,
  transactionDateHierarchy,
} from "@/modules/banking/queries";
import * as rules from "@/modules/banking/rules";
import { acceptTransfer, proposeTransfers } from "@/modules/banking/transfer-pairs";

const MAX_CSV_MB = 10;
const columnSchema = z.enum(TRANSACTION_COLUMN_KEYS as [TransactionColumn, ...TransactionColumn[]]);
const forbidden = {
  error: { code: "FORBIDDEN" as const, message: "Not allowed to read banking", retryable: false },
};

let _storage: ReturnType<typeof createStorageService> | null = null;
function getStorage() {
  if (!_storage) _storage = createStorageService();
  return _storage;
}

// --- reads (the accountant may read) ---

export const listTransactionsAction = authedAction
  .schema(z.object({ query: listQuerySchema }))
  .metadata({ name: "listBankTransactions" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return { data: await listTransactions(ctx.tx, parsedInput.query) };
  });

export const distinctTransactionsAction = authedAction
  .schema(z.object({ column: columnSchema, query: listQuerySchema }))
  .metadata({ name: "distinctBankTransactions" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return { data: await distinctTransactionValues(ctx.tx, parsedInput.column, parsedInput.query) };
  });

export const transactionDateHierarchyAction = authedAction
  .schema(z.object({ column: columnSchema, query: listQuerySchema }))
  .metadata({ name: "bankTransactionDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return { data: await transactionDateHierarchy(ctx.tx, parsedInput.column, parsedInput.query) };
  });

export const getTransactionAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getBankTransaction" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return getTransaction(ctx.tx, parsedInput.id);
  });

export const listImportsAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "listBankImports" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return { data: await listImports(ctx.tx) };
  });

export const accountBalancesAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "bankAccountBalances" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "bank_account")) return forbidden;
    return { data: await accountBalances(ctx.tx) };
  });

export const listRulesAction = authedAction
  .schema(z.object({}))
  .metadata({ name: "listCategorisationRules" })
  .action(async ({ ctx }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return { data: await listRulesWithLabels(ctx.tx) };
  });

export const proposeTransfersAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "proposeTransfers" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "bank_transaction")) return forbidden;
    return proposeTransfers(ctx.tx, parsedInput.id);
  });

// --- the import (owner only) ---

const importSchema = zfd.formData({
  file: zfd.file(
    z
      .instanceof(File)
      .refine((f) => f.size <= MAX_CSV_MB * 1024 * 1024, `File exceeds ${MAX_CSV_MB} MB limit`),
  ),
  bankAccountId: zfd.text(uuid),
});

export const importCsvAction = ownerAction
  .schema(importSchema)
  .metadata({ name: "importBankCsv" })
  .action(async ({ ctx, parsedInput }) => {
    const bytes = Buffer.from(await parsedInput.file.arrayBuffer());
    return importCsv(ctx.tx, ctx.callerIdentity, ctx.audit, getStorage(), {
      bankAccountId: parsedInput.bankAccountId,
      fileName: parsedInput.file.name,
      bytes,
    });
  });

/** The dialog's pre-selection: which account the filename (and the first row's currency) points at. */
export const detectAccountAction = ownerAction
  .schema(
    z.object({ fileName: z.string().max(255), firstRowCurrency: z.string().max(3).nullable() }),
  )
  .metadata({ name: "detectBankAccount" })
  .action(async ({ ctx, parsedInput }) => {
    const accounts = await ctx.tx.bankAccount.findMany({
      select: { id: true, accountNumber: true, currency: true },
    });
    const hint = detectAccountFromFilename(parsedInput.fileName);
    const picked = pickAccount(accounts, hint, parsedInput.firstRowCurrency);
    return { data: { hint, bankAccountId: picked?.id ?? null } };
  });

export const deleteImportAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteBankImport" })
  .action(async ({ ctx, parsedInput }) => {
    return deleteImport(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

// --- rules (owner only) ---

export const createRuleAction = ownerAction
  .schema(rules.ruleInputSchema)
  .metadata({ name: "createCategorisationRule" })
  .action(async ({ ctx, parsedInput }) => {
    return rules.createRule(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

export const updateRuleAction = ownerAction
  .schema(rules.updateRuleSchema)
  .metadata({ name: "updateCategorisationRule" })
  .action(async ({ ctx, parsedInput }) => {
    return rules.updateRule(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

export const deleteRuleAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteCategorisationRule" })
  .action(async ({ ctx, parsedInput }) => {
    return rules.deleteRule(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

export const testRuleAction = ownerAction
  .schema(rules.testRuleSchema)
  .metadata({ name: "testCategorisationRule" })
  .action(async ({ ctx, parsedInput }) => {
    return rules.testRule(ctx.tx, parsedInput);
  });

export const applyRulesAction = ownerAction
  .schema(z.object({ dryRun: z.boolean().default(true) }))
  .metadata({ name: "applyCategorisationRules" })
  .action(async ({ ctx, parsedInput }) => {
    return rules.applyRules(ctx.tx, ctx.callerIdentity, ctx.audit, { dryRun: parsedInput.dryRun });
  });

export const createRuleFromTransactionAction = ownerAction
  .schema(
    z.object({
      transactionId: uuid,
      name: z.string().trim().min(1).max(200).optional(),
      matchType: z.enum(["contains", "starts_with", "ends_with", "exact", "regex"]).optional(),
      matchPattern: z.string().trim().min(1).max(500).optional(),
      matchField: z
        .enum(["counterparty_key", "name", "details", "message", "sender", "recipient", "all"])
        .optional(),
      basCode: z
        .string()
        .regex(/^\d{3,4}$/)
        .nullable()
        .optional(),
      partnerId: uuid.nullable().optional(),
      noDocumentNeeded: z.boolean().optional(),
      priority: z.number().int().min(0).max(999).optional(),
    }),
  )
  .metadata({ name: "createRuleFromTransaction" })
  .action(async ({ ctx, parsedInput }) => {
    return rules.createRuleFromTransaction(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

// --- transfer pairs (owner only) ---

export const acceptTransferAction = ownerAction
  .schema(z.object({ fromId: uuid, toId: uuid }))
  .metadata({ name: "acceptTransferPair" })
  .action(async ({ ctx, parsedInput }) => {
    return acceptTransfer(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });
