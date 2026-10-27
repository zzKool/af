// Who pays (F114, D60, specs/linking/payment-record.md US4): the payers an expense or a subscription can name are
// bank accounts — the main accounts (the company pays; a `justifies` link from the row) and the owner's private
// instruments (`role = owner_private`: `Private SE`, `Private CH` — no CSV format, no rows; a `settles` link from
// the refund row reimburses). Savings accounts pay nothing. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { CURRENCIES } from "@/kernel/nav/constants";
import { accountLabel } from "./bank-accounts";
import { type BankAccountRole, type PayerKind, payerKindOf } from "./types";

/** A payer as the pickers show it: `kind` says which link reimburses or pays it. */
export type PayerAccount = {
  id: string;
  label: string;
  currency: string;
  role: BankAccountRole;
  kind: PayerKind;
};

export const privateAccountSchema = z.object({
  alias: z.string().trim().min(1, "A name is required").max(100),
  currency: z.enum(CURRENCIES),
});
export type PrivateAccountInput = z.input<typeof privateAccountSchema>;

/** The accounts that can pay an expense: main first, then the private instruments; never savings. */
export async function payerAccounts(tx: TransactionClient): Promise<PayerAccount[]> {
  const rows = await tx.bankAccount.findMany({
    where: { role: { in: ["main", "owner_private"] } },
    select: { id: true, accountAlias: true, accountNumber: true, currency: true, role: true },
    orderBy: [{ role: "asc" }, { accountNumber: "asc" }, { currency: "asc" }],
  });
  return rows.flatMap((a) => {
    const kind = payerKindOf(a.role);
    return kind
      ? [{ id: a.id, label: accountLabel(a), currency: a.currency, role: a.role, kind }]
      : [];
  });
}

/** One payer by id, or null — what another module validates `paid_from_account_id` with. */
export async function payerAccount(
  tx: TransactionClient,
  id: string,
): Promise<PayerAccount | null> {
  const a = await tx.bankAccount.findUnique({
    where: { id },
    select: { id: true, accountAlias: true, accountNumber: true, currency: true, role: true },
  });
  const kind = a ? payerKindOf(a.role) : null;
  if (!a || !kind) return null;
  return { id: a.id, label: accountLabel(a), currency: a.currency, role: a.role, kind };
}

/** A private instrument of the owner: alias + currency, no format; the alias is its number too (unique per currency). */
export async function createPrivateAccount(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: PrivateAccountInput,
): Promise<ServiceResult<PayerAccount>> {
  const parsed = privateAccountSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid input",
        retryable: false,
      },
    };
  }
  const { alias, currency } = parsed.data;
  const duplicate = await tx.bankAccount.findFirst({
    where: { accountNumber: alias, currency },
    select: { id: true },
  });
  if (duplicate) {
    return {
      error: {
        code: "DUPLICATE_ENTRY",
        message: `A payer named ${alias} in ${currency} already exists`,
        retryable: false,
      },
    };
  }
  const account = await tx.bankAccount.create({
    data: {
      tenantId: caller.tenantId,
      accountAlias: alias,
      accountNumber: alias,
      currency,
      bankFormatId: null,
      role: "owner_private",
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "bank_account",
    entityId: account.id,
    newData: toAuditData(account),
  });
  return {
    data: { id: account.id, label: alias, currency, role: "owner_private", kind: "private" },
  };
}
