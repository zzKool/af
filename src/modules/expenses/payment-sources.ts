// Payment sources (FR-002, US2): who paid an expense — a main bank account (`AF SEK`, `AF CHF`; bank_account_id is
// a validated UUID through banking) or a private instrument of the owner (`Private SE`, `Private CH`). The four
// are rows, seeded and created on first use; a referenced source is deactivated, never deleted.
// MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import type { PaymentSource } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { CURRENCIES } from "@/kernel/nav/constants";
import { uuid } from "@/kernel/validation/scalars";
import * as banking from "@/modules/banking";
import { invalid, notFound, violation } from "./errors";
import { PAYMENT_SOURCE_KINDS, type PaymentSourceDto, type PaymentSourceKind } from "./types";

export const paymentSourceInputSchema = z
  .object({
    label: z.string().trim().min(1, "Label is required").max(60),
    kind: z.enum(PAYMENT_SOURCE_KINDS),
    bankAccountId: uuid.nullable().optional(),
    currency: z.enum(CURRENCIES),
  })
  .refine((v) => (v.kind === "bank_account") === Boolean(v.bankAccountId), {
    message: "A bank-account source names its account; a private source has none",
  });
export type PaymentSourceInput = z.input<typeof paymentSourceInputSchema>;

export function toPaymentSourceDto(row: PaymentSource): PaymentSourceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    kind: row.kind as PaymentSourceKind,
    bankAccountId: row.bankAccountId,
    currency: row.currency,
    isActive: row.isActive,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createPaymentSource(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: PaymentSourceInput,
): Promise<ServiceResult<PaymentSourceDto>> {
  const parsed = paymentSourceInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const { label, kind, currency } = parsed.data;
  const bankAccountId = parsed.data.bankAccountId ?? null;
  if (bankAccountId) {
    const accounts = await banking.getBankAccounts(tx, caller);
    const account = (accounts.data ?? []).find((a) => a.id === bankAccountId);
    if (!account) return { error: notFound("Bank account", bankAccountId) };
    if (account.currency !== currency) {
      return {
        error: violation(
          `Account ${banking.accountLabel(account)} is in ${account.currency}, not ${currency}`,
        ),
      };
    }
  }
  const duplicate = await tx.paymentSource.findFirst({ where: { label }, select: { id: true } });
  if (duplicate) {
    return {
      error: {
        code: "DUPLICATE_ENTRY",
        message: `A payment source "${label}" exists`,
        retryable: false,
      },
    };
  }
  const row = await tx.paymentSource.create({
    data: {
      tenantId: caller.tenantId,
      label,
      kind,
      bankAccountId,
      currency,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "payment_source",
    entityId: row.id,
    newData: toAuditData(row),
  });
  return { data: toPaymentSourceDto(row) };
}

/** Activate / deactivate (US2-3): a deactivated source takes no new expenses; deletion does not exist. */
export async function setPaymentSourceActive(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  isActive: boolean,
): Promise<ServiceResult<PaymentSourceDto>> {
  const row = await tx.paymentSource.findUnique({ where: { id } });
  if (!row) return { error: notFound("Payment source", id) };
  if (row.isActive === isActive) return { data: toPaymentSourceDto(row) };
  const updated = await tx.paymentSource.update({ where: { id }, data: { isActive } });
  await audit.log({
    action: isActive ? "reactivate" : "deactivate",
    entityType: "payment_source",
    entityId: id,
    oldData: { isActive: row.isActive },
    newData: { isActive },
  });
  return { data: toPaymentSourceDto(updated) };
}

export async function listPaymentSources(tx: TransactionClient): Promise<PaymentSourceDto[]> {
  const rows = await tx.paymentSource.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] });
  return rows.map(toPaymentSourceDto);
}

export async function getPaymentSource(
  tx: TransactionClient,
  id: string,
): Promise<PaymentSourceDto | null> {
  const row = await tx.paymentSource.findUnique({ where: { id } });
  return row ? toPaymentSourceDto(row) : null;
}

/**
 * The owner's four sources when the tenant has none yet (FR-002): `AF {currency}` per main bank account,
 * `Private SE` (SEK), `Private CH` (CHF). Idempotent; returns the list either way.
 */
export async function ensureDefaultSources(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
): Promise<PaymentSourceDto[]> {
  const existing = await listPaymentSources(tx);
  if (existing.length > 0) return existing;
  const accounts = await banking.getBankAccounts(tx, caller);
  const seen = new Set<string>();
  // the account's role (main / savings) — an account attribute, nothing to do with user roles
  const mainAccounts = (accounts.data ?? []).filter((a) => !["savings"].includes(a.role));
  for (const a of mainAccounts) {
    const label = `AF ${a.currency}`;
    if (seen.has(label)) continue;
    seen.add(label);
    await createPaymentSource(tx, caller, audit, {
      label,
      kind: "bank_account",
      bankAccountId: a.id,
      currency: a.currency as (typeof CURRENCIES)[number],
    });
  }
  await createPaymentSource(tx, caller, audit, {
    label: "Private SE",
    kind: "private",
    currency: "SEK",
  });
  await createPaymentSource(tx, caller, audit, {
    label: "Private CH",
    kind: "private",
    currency: "CHF",
  });
  return listPaymentSources(tx);
}
