// The trip of a trip group (specs/traktamente US1–US3, FR-002, FR-004): departure / return, country, meals as
// counts; the computed breakdown is stored as a snapshot and written as one `per_diem` expense through the
// expenses module (SEK, the owner's private SE source). Recompute replaces the expense while it is open.
// MUST NOT import from next/* or src/components/*.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import { Prisma, type Trip } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { uuid } from "@/kernel/validation/scalars";
import * as expenses from "@/modules/expenses";
import {
  computePerDiem,
  countDays,
  PerDiemError,
  perDiemDescription,
  perDiemNote,
  TENANT_ZONE,
} from "./calculator";
import { ratesForYears } from "./rates";
import type { PerDiemResult, PerDiemWarning, TripDto } from "./types";

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
const notFound = (what: string, id: string): AppError => ({
  code: "NOT_FOUND",
  message: `${what} not found: ${id}`,
  retryable: false,
});

const count = z.number().int().min(0).max(999);

/** A snapshot written before T003 holds its warnings as English lines: the known ones read as typed again. */
function legacyWarning(line: string): PerDiemWarning {
  const years = /^trip spans two rate years \((.+)\)$/.exec(line);
  if (years?.[1]) return { type: "two_rate_years", message: line, years: years[1] };
  if (line.startsWith("the meal deduction exceeds the day amounts"))
    return { type: "meals_exceed_days", message: line };
  return { type: "other", message: line };
}

const warningSchema: z.ZodType<PerDiemWarning, unknown> = z.union([
  z.object({ type: z.literal("two_rate_years"), message: z.string(), years: z.string() }),
  z.object({ type: z.literal("meals_exceed_days"), message: z.string() }),
  z.object({ type: z.literal("other"), message: z.string() }),
  z.string().transform(legacyWarning),
]);

/** The stored breakdown (`trips.computed`, JSONB) as the calculator writes it — parsed on read, never cast (F62). */
export const perDiemResultSchema: z.ZodType<PerDiemResult, unknown> = z.object({
  fullDays: z.number(),
  halfDays: z.number(),
  nights: z.number(),
  days: z.number(),
  reason: z.string().nullable(),
  countryCode: z.string(),
  rateYears: z.array(z.number().int()),
  mealRateYear: z.number().int(),
  perDay: z.array(
    z.object({
      date: z.string(),
      kind: z.enum(["full", "half"]),
      year: z.number().int(),
      amount: z.string(),
    }),
  ),
  dayTotal: z.string(),
  meals: z.object({
    breakfasts: z.number(),
    lunches: z.number(),
    dinners: z.number(),
    deduction: z.string(),
  }),
  nightAllowance: z.object({ nights: z.number(), nightAmount: z.string(), total: z.string() }),
  longStayFactor: z.string().nullable(),
  total: z.string(),
  warnings: z.array(warningSchema),
  computedAt: z.string(),
});

/** The stored snapshot, or null when there is none or it does not read as a breakdown. */
export function parsePerDiemResult(value: unknown): PerDiemResult | null {
  if (value === null || value === undefined) return null;
  const parsed = perDiemResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const tripInputSchema = z
  .object({
    groupId: uuid,
    /** ISO timestamps (with offset) or local `YYYY-MM-DDTHH:mm` in the tenant zone */
    departureAt: z.string().min(16),
    returnAt: z.string().min(16),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "A country code is two letters"),
    agency: z.string().trim().max(100).nullable().optional(),
    breakfasts: count.optional(),
    lunches: count.optional(),
    dinners: count.optional(),
    nightsWithoutPaidLodging: count.optional(),
    longStayFactor: z
      .string()
      .regex(/^(0\.\d{1,2}|1(\.0{1,2})?)$/, "A factor between 0 and 1")
      .nullable()
      .optional(),
  })
  .refine((v) => toInstant(v.returnAt) > toInstant(v.departureAt), {
    message: "The return must be after the departure",
  });
export type TripInput = z.input<typeof tripInputSchema>;

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** A local time in the tenant zone → the instant (Stockholm offset of that date). */
export function toInstant(value: string, zone: string = TENANT_ZONE): Date {
  if (!LOCAL.test(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error(`Not a timestamp: "${value}"`);
    return d;
  }
  // find the offset of the zone at that wall time: format a guess, compare, adjust once (DST-safe)
  const guess = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
  const offset = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return (asUtc - d.getTime()) / 60_000;
  };
  const first = new Date(guess.getTime() - offset(guess) * 60_000);
  return new Date(guess.getTime() - offset(first) * 60_000);
}

export function toTripDto(row: Trip): TripDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    groupId: row.groupId,
    departureAt: row.departureAt,
    returnAt: row.returnAt,
    countryCode: row.countryCode,
    agency: row.agency,
    breakfasts: row.breakfasts,
    lunches: row.lunches,
    dinners: row.dinners,
    nightsWithoutPaidLodging: row.nightsWithoutPaidLodging,
    longStayFactor: row.longStayFactor ? row.longStayFactor.toString() : null,
    computed: parsePerDiemResult(row.computed),
    perDiemExpenseId: row.perDiemExpenseId,
    perDiemDocumentId: row.perDiemDocumentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The breakdown of a trip row against the tenant's rates — or the error naming what is missing. */
export async function computeForTrip(
  tx: TransactionClient,
  trip: Pick<
    Trip,
    | "departureAt"
    | "returnAt"
    | "countryCode"
    | "breakfasts"
    | "lunches"
    | "dinners"
    | "nightsWithoutPaidLodging"
    | "longStayFactor"
  >,
): Promise<ServiceResult<PerDiemResult>> {
  const years = [...new Set(countDays(trip.departureAt, trip.returnAt).perDay.map((d) => d.year))];
  const rates = await ratesForYears(tx, trip.countryCode, years);
  try {
    return {
      data: computePerDiem(
        {
          departureAt: trip.departureAt,
          returnAt: trip.returnAt,
          countryCode: trip.countryCode,
          breakfasts: trip.breakfasts,
          lunches: trip.lunches,
          dinners: trip.dinners,
          nightsWithoutPaidLodging: trip.nightsWithoutPaidLodging,
          longStayFactor: trip.longStayFactor ? trip.longStayFactor.toString() : null,
        },
        rates,
      ),
    };
  } catch (e) {
    if (e instanceof PerDiemError) return { error: violation(e.message, e.details) };
    throw e;
  }
}

/**
 * Create or update the group's trip; the group becomes a trip group. The snapshot is stored when the rates allow
 * a computation; otherwise the trip is saved, the snapshot cleared and the computation error returned alongside
 * (`computeError`).
 */
export async function upsertTrip(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: TripInput,
): Promise<ServiceResult<{ trip: TripDto; computeError: AppError | null }>> {
  const parsed = tripInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const group = await tx.expenseGroup.findUnique({
    where: { id: v.groupId },
    include: { trip: true },
  });
  if (!group) return { error: notFound("Expense group", v.groupId) };
  if (group.kind !== "trip") {
    const r = await expenses.updateGroup(tx, caller, audit, group.id, { kind: "trip" });
    if (r.error) return { error: r.error };
  }
  const data = {
    departureAt: toInstant(v.departureAt),
    returnAt: toInstant(v.returnAt),
    countryCode: v.countryCode,
    agency: v.agency ?? null,
    breakfasts: v.breakfasts ?? 0,
    lunches: v.lunches ?? 0,
    dinners: v.dinners ?? 0,
    nightsWithoutPaidLodging: v.nightsWithoutPaidLodging ?? 0,
    longStayFactor: v.longStayFactor ?? null,
  };
  const computed = await computeForTrip(tx, {
    ...data,
    longStayFactor: data.longStayFactor ? new Prisma.Decimal(data.longStayFactor) : null,
  });
  // a failed computation clears the snapshot: the panel and the PDF never show a breakdown of other inputs (F62)
  const snapshot = computed.data ? JSON.parse(JSON.stringify(computed.data)) : undefined;
  const row = group.trip
    ? await tx.trip.update({
        where: { id: group.trip.id },
        data: { ...data, computed: snapshot ?? Prisma.DbNull },
      })
    : await tx.trip.create({
        data: {
          tenantId: caller.tenantId,
          groupId: group.id,
          ...data,
          computed: snapshot,
          createdBy: caller.userId,
          source: caller.source,
        },
      });
  await audit.log({
    action: group.trip ? "update" : "create",
    entityType: "trip",
    entityId: row.id,
    oldData: group.trip ? toAuditData(group.trip) : null,
    newData: toAuditData(row),
  });
  return { data: { trip: toTripDto(row), computeError: computed.error ?? null } };
}

/** The live result for the panel — nothing written. */
export async function previewPerDiem(
  tx: TransactionClient,
  groupId: string,
): Promise<ServiceResult<PerDiemResult>> {
  const trip = await tx.trip.findUnique({ where: { groupId } });
  if (!trip) return { error: notFound("Trip", groupId) };
  return computeForTrip(tx, trip);
}

/** Two breakdowns of the same inputs: equal in everything but `computedAt` (JSONB reorders keys — compare deep). */
function sameBreakdown(stored: PerDiemResult | null, fresh: PerDiemResult): boolean {
  if (!stored) return false;
  const { computedAt: _a, ...a } = stored;
  const { computedAt: _b, ...b } = JSON.parse(JSON.stringify(fresh)) as PerDiemResult;
  return isDeepStrictEqual(a, b);
}

/** The expense already carries these facts (the amount compared as a Decimal, not as text). */
function carries(
  e: expenses.ExpenseDto,
  f: { date: string; description: string; amount: string; note: string },
): boolean {
  return (
    e.date === f.date &&
    e.description === f.description &&
    (e.note ?? "") === f.note &&
    new Prisma.Decimal(e.amount).eq(f.amount)
  );
}

/**
 * Write (or replace) the trip's per-diem expense (US3): kind `per_diem`, SEK, the owner's private SE source,
 * `basCode` the travel category, the breakdown in the note. Refused when the existing one is settled —
 * a correction is a new expense by hand (D-e).
 */
export async function createOrReplacePerDiemExpense(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { groupId: string; basCode: string },
): Promise<ServiceResult<{ trip: TripDto; expense: expenses.ExpenseDto }>> {
  const trip = await tx.trip.findUnique({ where: { groupId: input.groupId } });
  if (!trip) return { error: notFound("Trip", input.groupId) };
  const computed = await computeForTrip(tx, trip);
  if (computed.error) return { error: computed.error };
  const result = computed.data;
  if (result.reason) return { error: violation(`Nothing is tax-free: ${result.reason}`) };
  const returnDate = result.perDay[result.perDay.length - 1]?.date ?? "";
  const facts = {
    date: returnDate,
    description: perDiemDescription(result),
    amount: result.total,
    note: perDiemNote(result),
  };
  if (new Prisma.Decimal(result.total).lte(0))
    return { error: violation("The per-diem is 0 — nothing to write") };

  let expense: ServiceResult<expenses.ExpenseDto>;
  const existing = trip.perDiemExpenseId
    ? await expenses.getExpense(tx, trip.perDiemExpenseId)
    : null;
  // unchanged inputs: the stored breakdown and the expense already say it — nothing to rewrite, no new PDF (US3/AC2)
  if (
    existing &&
    sameBreakdown(parsePerDiemResult(trip.computed), result) &&
    carries(existing, facts)
  )
    return { data: { trip: toTripDto(trip), expense: existing } };
  if (existing) {
    expense = await expenses.replacePerDiemExpense(tx, caller, audit, existing.id, facts);
  } else {
    expense = await expenses.createPerDiemExpense(tx, caller, audit, {
      groupId: input.groupId,
      basCode: input.basCode,
      ...facts,
    });
  }
  if (expense.error) return { error: expense.error };
  const snapshot = JSON.parse(JSON.stringify(result));
  // the breakdown PDF is rendered again by the job (a recompute supersedes the previous one)
  const row = await tx.trip.update({
    where: { id: trip.id },
    data: { computed: snapshot, perDiemExpenseId: expense.data.id, perDiemDocumentId: null },
  });
  await audit.log({
    action: "update",
    entityType: "trip",
    entityId: trip.id,
    newData: { perDiemExpenseId: expense.data.id, total: result.total, days: result.days },
  });
  return { data: { trip: toTripDto(row), expense: expense.data } };
}

export async function getTrip(tx: TransactionClient, groupId: string): Promise<TripDto | null> {
  const row = await tx.trip.findUnique({ where: { groupId } });
  return row ? toTripDto(row) : null;
}
