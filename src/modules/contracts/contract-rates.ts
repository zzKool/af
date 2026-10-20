// Contract rate history (D24, specs/contracts/spec.md). Intervals are calendar days, inclusive on both ends,
// never overlapping. The lookup for a date is the module's contract with invoices; "current rate" is derived.
// MUST NOT import from next/* or src/components/*
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { ContractRate } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError } from "@/kernel/errors/app-error";
import { addDays } from "./calendar";
import type { ContractRateDto, ContractRateWithState, RateState, RateUnit } from "./types";
import { RATE_UNITS } from "./types";

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

const violation = (message: string, details?: Record<string, string | number>): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});

const notFound = (id: string): AppError => ({
  code: "NOT_FOUND",
  message: `Contract rate not found: ${id}`,
  retryable: false,
});

// --- Zod schemas (the boundary) ---

const isoDate = z.string().date();
const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Invalid rate format — use digits with up to 2 decimal places")
  .refine((v) => Number.parseFloat(v) > 0, "Rate must be greater than zero");

const rateFields = {
  validFrom: isoDate,
  validTo: isoDate.nullable().optional(),
  rate: money,
  unit: z.enum(RATE_UNITS as [RateUnit, ...RateUnit[]]).default("day"),
  note: z.string().trim().max(500).nullable().optional(),
};

export const createContractRateSchema = z
  .object({ contractId: z.string().uuid(), ...rateFields })
  .refine((d) => !d.validTo || d.validTo >= d.validFrom, {
    message: "Valid to must be on or after valid from",
    path: ["validTo"],
  });

export const updateContractRateSchema = z
  .object({ id: z.string().uuid() })
  .extend({
    validFrom: isoDate.optional(),
    validTo: isoDate.nullable().optional(),
    rate: money.optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((d) => !d.validFrom || !d.validTo || d.validTo >= d.validFrom, {
    message: "Valid to must be on or after valid from",
    path: ["validTo"],
  });

export type CreateContractRateInput = z.input<typeof createContractRateSchema>;
export type UpdateContractRateInput = z.input<typeof updateContractRateSchema>;

// --- pure pieces (tested without a DB in rate-for.pure.test.ts) ---

export type RateInterval = { validFrom: string; validTo: string | null };

/** Inclusive calendar-day containment; open end = forever. ISO strings compare lexically. */
export function covers(r: RateInterval, date: string): boolean {
  return r.validFrom <= date && (r.validTo === null || r.validTo >= date);
}

export function overlaps(a: RateInterval, b: RateInterval): boolean {
  const aEnd = a.validTo ?? "9999-12-31";
  const bEnd = b.validTo ?? "9999-12-31";
  return a.validFrom <= bEnd && b.validFrom <= aEnd;
}

/** The one interval that contains `date`, or null. With non-overlapping input there is at most one. */
export function pickRate<T extends RateInterval>(rates: readonly T[], date: string): T | null {
  const hits = rates.filter((r) => covers(r, date));
  if (hits.length === 0) return null;
  // Defensive: should the data ever overlap (it cannot — exclusion constraint), the latest start wins (v1 R6).
  return hits.reduce((best, r) => (r.validFrom > best.validFrom ? r : best));
}

export function rateState(r: RateInterval, today: string): RateState {
  if (r.validFrom > today) return "future";
  if (r.validTo !== null && r.validTo < today) return "expired";
  return "current";
}

// --- DTO mapping ---

/** `@db.Date` columns come back as UTC-midnight Dates; the calendar day is the UTC date. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toContractRateDto(row: ContractRate): ContractRateDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contractId: row.contractId,
    validFrom: toIsoDate(row.validFrom),
    validTo: row.validTo ? toIsoDate(row.validTo) : null,
    rate: row.rate.toFixed(2),
    unit: row.unit,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// --- reads ---

/** All rates of one contract, newest first, with the state relative to `today` (clock.today()). */
export async function listContractRates(
  tx: TransactionClient,
  contractId: string,
  today: string,
): Promise<ServiceResult<ContractRateWithState[]>> {
  const rows = await tx.contractRate.findMany({
    where: { contractId },
    orderBy: { validFrom: "desc" },
  });
  return {
    data: rows.map((r) => {
      const dto = toContractRateDto(r);
      return { ...dto, state: rateState(dto, today) };
    }),
  };
}

/** Rates of several contracts in one query (the partner page), grouped by contract id. */
export async function listContractRatesFor(
  tx: TransactionClient,
  contractIds: readonly string[],
  today: string,
): Promise<Record<string, ContractRateWithState[]>> {
  if (contractIds.length === 0) return {};
  const rows = await tx.contractRate.findMany({
    where: { contractId: { in: [...contractIds] } },
    orderBy: { validFrom: "desc" },
  });
  const out: Record<string, ContractRateWithState[]> = {};
  for (const id of contractIds) out[id] = [];
  for (const r of rows) {
    const dto = toContractRateDto(r);
    out[r.contractId]?.push({ ...dto, state: rateState(dto, today) });
  }
  return out;
}

/**
 * The rate valid on `date` (ISO calendar day), or null — the invoice line asks for `period_start` (D24).
 * Independent of today, of the contract's own dates and of its active flag (a rate is a fact about a period).
 */
export async function rateFor(
  tx: TransactionClient,
  contractId: string,
  date: string,
): Promise<ContractRateDto | null> {
  const d = toDate(date);
  const row = await tx.contractRate.findFirst({
    where: {
      contractId,
      validFrom: { lte: d },
      OR: [{ validTo: null }, { validTo: { gte: d } }],
    },
    orderBy: { validFrom: "desc" },
  });
  return row ? toContractRateDto(row) : null;
}

/** `rateFor(today)` for many contracts at once — what `getContracts` uses for `currentRate`. */
export async function currentRatesFor(
  tx: TransactionClient,
  contractIds: readonly string[],
  today: string,
): Promise<Map<string, ContractRateDto>> {
  const out = new Map<string, ContractRateDto>();
  if (contractIds.length === 0) return out;
  const d = toDate(today);
  const rows = await tx.contractRate.findMany({
    where: {
      contractId: { in: [...contractIds] },
      validFrom: { lte: d },
      OR: [{ validTo: null }, { validTo: { gte: d } }],
    },
    orderBy: { validFrom: "desc" },
  });
  for (const r of rows) if (!out.has(r.contractId)) out.set(r.contractId, toContractRateDto(r));
  return out;
}

// --- writes ---

/** Hook for the invoices module: how many invoice lines snapshot this rate. 0 until invoices exist. */
export type RateUsage = (tx: TransactionClient, rateId: string) => Promise<number>;
let rateUsage: RateUsage = async () => 0;
export function setRateUsage(fn: RateUsage): void {
  rateUsage = fn;
}

function overlapError(other: ContractRateDto): AppError {
  return violation(
    `This rate overlaps an existing rate (${other.validFrom} → ${other.validTo ?? "open"})`,
    { from: other.validFrom, to: other.validTo ?? "open", rateId: other.id },
  );
}

/** Exclusion constraint (SQLSTATE 23P01) raised despite the pre-check = a concurrent writer; same answer. */
function isExclusionViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; meta?: { code?: string; driverAdapterError?: unknown } };
  if (e.code === "P2004") return true; // Prisma: constraint failed on the database
  return JSON.stringify(e).includes("contract_rates_no_overlap");
}

/**
 * Add a rate. An open-ended rate closes the contract's open rate on `validFrom − 1` when that one started
 * earlier (audited as an update); every other overlap is refused. Both writes happen in the caller's tx.
 */
export async function createContractRate(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: CreateContractRateInput,
): Promise<ServiceResult<ContractRateDto>> {
  const parsed = createContractRateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid rate",
        retryable: false,
      },
    };
  }
  const data = parsed.data;
  const contract = await tx.contract.findUnique({ where: { id: data.contractId } });
  if (!contract) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `Contract not found: ${data.contractId}`,
        retryable: false,
      },
    };
  }

  const existing = (await tx.contractRate.findMany({ where: { contractId: data.contractId } })).map(
    toContractRateDto,
  );
  const candidate: RateInterval = { validFrom: data.validFrom, validTo: data.validTo ?? null };

  // Auto-close (spec FR-003): only the open rate that started before the new open-ended one.
  const toClose =
    candidate.validTo === null
      ? existing.find((r) => r.validTo === null && r.validFrom < candidate.validFrom)
      : undefined;
  const clash = existing.find((r) => r.id !== toClose?.id && overlaps(r, candidate));
  if (clash) return { error: overlapError(clash) };

  try {
    if (toClose) {
      const closedOn = addDays(candidate.validFrom, -1);
      const updated = await tx.contractRate.update({
        where: { id: toClose.id },
        data: { validTo: toDate(closedOn) },
      });
      await audit.log({
        action: "update",
        entityType: "contract_rate",
        entityId: toClose.id,
        oldData: toAuditData({ ...toClose, reason: "auto-close" }),
        newData: toAuditData({ ...toContractRateDto(updated), reason: "auto-close" }),
      });
    }
    const row = await tx.contractRate.create({
      data: {
        tenantId: caller.tenantId,
        contractId: data.contractId,
        validFrom: toDate(data.validFrom),
        validTo: data.validTo ? toDate(data.validTo) : null,
        rate: new Prisma.Decimal(data.rate),
        unit: data.unit,
        note: data.note || null,
        createdBy: caller.userId,
        source: caller.source,
      },
    });
    const dto = toContractRateDto(row);
    await audit.log({
      action: "create",
      entityType: "contract_rate",
      entityId: row.id,
      newData: toAuditData(dto),
    });
    return { data: dto };
  } catch (error: unknown) {
    if (isExclusionViolation(error)) {
      return { error: violation("This rate overlaps an existing rate") };
    }
    throw error;
  }
}

/** Edit dates, amount or note; the corrected interval must still overlap nothing (itself excluded). */
export async function updateContractRate(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: UpdateContractRateInput,
): Promise<ServiceResult<ContractRateDto>> {
  const parsed = updateContractRateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid rate",
        retryable: false,
      },
    };
  }
  const { id, ...data } = parsed.data;
  const row = await tx.contractRate.findUnique({ where: { id } });
  if (!row) return { error: notFound(id) };
  const before = toContractRateDto(row);

  const next: RateInterval = {
    validFrom: data.validFrom ?? before.validFrom,
    validTo: data.validTo === undefined ? before.validTo : data.validTo,
  };
  if (next.validTo !== null && next.validTo < next.validFrom) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "Valid to must be on or after valid from",
        retryable: false,
      },
    };
  }
  const others = (
    await tx.contractRate.findMany({ where: { contractId: row.contractId, id: { not: id } } })
  ).map(toContractRateDto);
  const clash = others.find((r) => overlaps(r, next));
  if (clash) return { error: overlapError(clash) };

  const updateData: Prisma.ContractRateUpdateInput = {};
  if (data.validFrom !== undefined) updateData.validFrom = toDate(data.validFrom);
  if (data.validTo !== undefined) updateData.validTo = data.validTo ? toDate(data.validTo) : null;
  if (data.rate !== undefined) updateData.rate = new Prisma.Decimal(data.rate);
  if (data.note !== undefined) updateData.note = data.note || null;
  void caller;

  try {
    const updated = await tx.contractRate.update({ where: { id }, data: updateData });
    const dto = toContractRateDto(updated);
    await audit.log({
      action: "update",
      entityType: "contract_rate",
      entityId: id,
      oldData: toAuditData(before),
      newData: toAuditData(dto),
    });
    return { data: dto };
  } catch (error: unknown) {
    if (isExclusionViolation(error)) {
      return { error: violation("This rate overlaps an existing rate") };
    }
    throw error;
  }
}

/** Delete a rate no invoice line references (the usage hook is wired by the invoices module). */
export async function deleteContractRate(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ id: string }>> {
  const row = await tx.contractRate.findUnique({ where: { id } });
  if (!row) return { error: notFound(id) };
  const used = await rateUsage(tx, id);
  if (used > 0) {
    return {
      error: violation(
        `This rate is used on ${used} invoice line(s) and cannot be deleted — close it instead`,
        { n: used },
      ),
    };
  }
  void caller;
  await tx.contractRate.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "contract_rate",
    entityId: id,
    oldData: toAuditData(toContractRateDto(row)),
  });
  return { data: { id } };
}
