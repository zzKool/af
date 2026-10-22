import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { CURRENCIES } from "@/kernel/nav/constants";
import { BANK_ACCOUNT_ROLES, type BankAccountRole } from "./types";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

/**
 * Get all bank CSV formats (app-level reference data, no RLS).
 * Any authenticated user can read — no caller/audit params needed.
 *
 * Architectural exception: bank_formats has no tenant_id and no RLS.
 * It's a read-only reference table (immutability enforced via PostgreSQL RULEs).
 */
export async function getBankFormats(tx: TransactionClient) {
  const formats = await tx.bankFormat.findMany({
    orderBy: { name: "asc" },
  });
  return formats;
}

/**
 * Get all bank accounts for the tenant (RLS-scoped by middleware).
 * Includes bank format relation for display.
 * Read-only — no audit param needed.
 */
export async function getBankAccounts(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<
  ServiceResult<
    {
      id: string;
      accountAlias: string | null;
      accountNumber: string;
      currency: string;
      bankFormatId: string;
      role: BankAccountRole;
      iban: string | null;
      bic: string | null;
      /** CSV imports into this account — number and currency are locked when > 0 (F65) */
      imports: number;
      bankFormat: {
        id: string;
        name: string;
        bankName: string;
        delimiter: string;
        decimalSeparator: string;
        dateFormat: string;
        encoding: string;
        columnMapping: unknown;
      };
      createdAt: Date;
      updatedAt: Date;
    }[]
  >
> {
  const accounts = await tx.bankAccount.findMany({
    include: { bankFormat: true, _count: { select: { imports: true } } },
    orderBy: [{ accountNumber: "asc" }, { currency: "asc" }],
  });
  return {
    data: accounts.map(({ _count, ...a }) => ({
      ...a,
      role: a.role as BankAccountRole,
      imports: _count.imports,
    })),
  };
}

/** `Plusgirokonto SEK` — the alias, else `{number} {currency}` */
export function accountLabel(a: {
  accountAlias: string | null;
  accountNumber: string;
  currency: string;
}): string {
  return a.accountAlias?.trim() || `${a.accountNumber} ${a.currency}`;
}

/** the account's role (main / savings) — an account attribute, nothing to do with user roles */
function checkRole(input: { role?: BankAccountRole }): AppError | null {
  const value = input.role;
  if (value === undefined || BANK_ACCOUNT_ROLES.includes(value)) return null;
  return {
    code: "VALIDATION_ERROR",
    message: `Invalid account role: ${value}. Must be one of: ${BANK_ACCOUNT_ROLES.join(", ")}`,
    retryable: false,
  };
}

/**
 * Create a new bank account for the tenant.
 * Validates currency against CURRENCIES constant and bankFormatId existence.
 * Catches Prisma P2002 for duplicate accountNumber+currency → DUPLICATE_ENTRY.
 */
export async function createBankAccount(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: {
    accountAlias?: string;
    accountNumber: string;
    currency: string;
    bankFormatId: string;
    role?: BankAccountRole;
    iban?: string | null;
    bic?: string | null;
  },
): Promise<ServiceResult<{ id: string }>> {
  const roleCheck = checkRole(input);
  if (roleCheck) return { error: roleCheck };
  // Validate currency is in CURRENCIES constant
  if (!CURRENCIES.includes(input.currency as (typeof CURRENCIES)[number])) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Invalid currency: ${input.currency}. Must be one of: ${CURRENCIES.join(", ")}`,
        retryable: false,
      },
    };
  }

  // Validate bankFormatId exists in app-level table
  const format = await tx.bankFormat.findUnique({ where: { id: input.bankFormatId } });
  if (!format) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: `Bank format not found: ${input.bankFormatId}`,
        retryable: false,
      },
    };
  }

  try {
    const account = await tx.bankAccount.create({
      data: {
        tenantId: caller.tenantId,
        accountAlias: input.accountAlias ?? null,
        accountNumber: input.accountNumber,
        currency: input.currency,
        bankFormatId: input.bankFormatId,
        role: input.role ?? "main",
        iban: input.iban ?? null,
        bic: input.bic ?? null,
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

    return { data: { id: account.id } };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: "A bank account with this account number and currency already exists",
          retryable: false,
        },
      };
    }
    throw error;
  }
}

/**
 * Update an existing bank account.
 * Read-before-write for audit oldData/newData.
 * Validates bankFormatId if changed, catches P2002 for duplicate.
 */
export async function updateBankAccount(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: {
    accountAlias?: string | null;
    accountNumber?: string;
    currency?: string;
    bankFormatId?: string;
    role?: BankAccountRole;
    iban?: string | null;
    bic?: string | null;
  },
): Promise<ServiceResult<{ updated: boolean }>> {
  const roleCheck = checkRole(input);
  if (roleCheck) return { error: roleCheck };
  // Validate currency if provided
  if (input.currency !== undefined) {
    if (!CURRENCIES.includes(input.currency as (typeof CURRENCIES)[number])) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid currency: ${input.currency}. Must be one of: ${CURRENCIES.join(", ")}`,
          retryable: false,
        },
      };
    }
  }

  // Validate bankFormatId if changed
  if (input.bankFormatId !== undefined) {
    const format = await tx.bankFormat.findUnique({ where: { id: input.bankFormatId } });
    if (!format) {
      return {
        error: {
          code: "VALIDATION_ERROR",
          message: `Bank format not found: ${input.bankFormatId}`,
          retryable: false,
        },
      };
    }
  }

  const existing = await tx.bankAccount.findUnique({ where: { id } });
  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `Bank account not found: ${id}`,
        retryable: false,
      },
    };
  }

  // the number and currency say which CSV rows belong here: once a statement is imported they are history (F65)
  const lockedChange =
    (input.accountNumber !== undefined && input.accountNumber !== existing.accountNumber) ||
    (input.currency !== undefined && input.currency !== existing.currency);
  if (lockedChange) {
    const imports = await tx.bankImport.count({ where: { bankAccountId: id } });
    if (imports > 0) {
      return {
        error: {
          code: "BUSINESS_RULE_VIOLATION",
          message: `This account has ${imports} import(s); its number and currency can no longer change`,
          retryable: false,
          details: { imports },
        },
      };
    }
  }

  const updateData: {
    accountAlias?: string | null;
    accountNumber?: string;
    currency?: string;
    bankFormatId?: string;
    role?: BankAccountRole;
    iban?: string | null;
    bic?: string | null;
  } = {};
  if ("role" in input && input.role) updateData.role = input.role;
  if (input.iban !== undefined) updateData.iban = input.iban;
  if (input.bic !== undefined) updateData.bic = input.bic;
  if (input.accountAlias !== undefined) updateData.accountAlias = input.accountAlias;
  if (input.accountNumber !== undefined) updateData.accountNumber = input.accountNumber;
  if (input.currency !== undefined) updateData.currency = input.currency;
  if (input.bankFormatId !== undefined) updateData.bankFormatId = input.bankFormatId;

  try {
    const updated = await tx.bankAccount.update({
      where: { id },
      data: updateData,
    });

    await audit.log({
      action: "update",
      entityType: "bank_account",
      entityId: id,
      oldData: toAuditData(existing),
      newData: toAuditData(updated),
    });

    return { data: { updated: true } };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: "A bank account with this account number and currency already exists",
          retryable: false,
        },
      };
    }
    throw error;
  }
}

/**
 * Delete a bank account.
 * Read-before-delete for audit oldData.
 */
export async function deleteBankAccount(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: boolean }>> {
  const existing = await tx.bankAccount.findUnique({ where: { id } });
  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `Bank account not found: ${id}`,
        retryable: false,
      },
    };
  }
  // an account with imports keeps its history: delete the imports first (each one checked for links)
  const imports = await tx.bankImport.count({ where: { bankAccountId: id } });
  if (imports > 0) {
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: `This account has ${imports} import(s); delete them first`,
        retryable: false,
        details: { imports },
      },
    };
  }

  await tx.bankAccount.delete({ where: { id } });

  await audit.log({
    action: "delete",
    entityType: "bank_account",
    entityId: id,
    oldData: toAuditData(existing),
  });

  return { data: { deleted: true } };
}
